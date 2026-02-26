import { App, Plugin, PluginSettingTab, Setting, Notice, TFile, TAbstractFile, FileSystemAdapter } from 'obsidian';
import { ServerMessage, FileChangeMessage, FileDeleteMessage, FileRenameMessage, SyncResponseMessage, FileInfo, SyncRequest, FileChangeResponseMessage, ConflictResolutionMessage, BinaryFileChangeMessage, RegisterDeviceResponseMessage } from './types';
import { HashUtils } from './utils/hash-utils';
import { FileUtils } from './utils/file-utils';
import { ErrorUtils } from './utils/error-utils';
import { MessageFactory } from './message/message-factory';
import { SettingsValidator } from './validation/settings-validator';
import { SyncManager } from './sync/sync-manager';
import { ConnectionManager } from './connection/connection-manager';

interface AutoSyncSettings {
	serverUrl: string;
	serverPort: number;
	vaultId: string;
	deviceName: string;
	enableSync: boolean;
	syncInterval: number;
}

const DEFAULT_SETTINGS: AutoSyncSettings = {
	serverUrl: '10.0.0.1',
	serverPort: 3001,
	vaultId: '',
	deviceName: '',
	enableSync: false,
	syncInterval: 1000
};

/**
 * Obsidian Auto Sync Plugin
 * 
 *     Obsidian .
 * WebSocket       .
 */
export default class AutoSyncPlugin extends Plugin {
	/**   */
	settings: AutoSyncSettings;
	/**   ID */
	deviceId: string;
	/**   */
	syncStatusBar: HTMLElement;
	/**   */
	private syncManager: SyncManager;
	/**   */
	private connectionManager: ConnectionManager;
	/**    */
	private cleanupInterval: NodeJS.Timeout | null = null;
	/**      */
	private isRemoteSyncInProgress: boolean = false;
	/**     ( ) */
	private serverFileList: Set<string> = new Set();
	/**       */
	private remoteOperationsInProgress: Set<string> = new Set();
	/**     */
	private isDeviceRegistered: boolean = false;

	/**
	 *      
	 */
	async onload() {
		await this.loadSettings();
		
		this.deviceId = this.generateDeviceId();
		if (!this.settings.deviceName) {
			this.settings.deviceName = `Device-${this.deviceId.substring(0, 8)}`;
			await this.saveSettings();
		}

		// UI  
		this.addRibbonIcon('sync', 'Auto Sync', () => {
			this.toggleSync();
		});

		this.addCommand({
			id: 'toggle-sync',
			name: 'Toggle Auto Sync',
			callback: () => {
				this.toggleSync();
			}
		});

		this.addCommand({
			id: 'force-sync',
			name: 'Force Sync Now',
			callback: () => {
				this.forceSyncAll();
			}
		});

		this.addSettingTab(new AutoSyncSettingTab(this.app, this));
		this.syncStatusBar = this.addStatusBarItem();
		this.updateStatusBar();

		//   
		this.registerEvent(
			this.app.vault.on('modify', (file) => this.onFileModified(file))
		);
		
		this.registerEvent(
			this.app.vault.on('create', (file) => this.onFileCreated(file))
		);
		
		this.registerEvent(
			this.app.vault.on('delete', (file) => this.onFileDeleted(file))
		);

		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => this.onFileRenamed(file, oldPath))
		);

		//   
		this.syncManager = new SyncManager(
			this.app,
			this.settings.syncInterval,
			(message) => this.connectionManager?.sendMessage(message) ?? false,
			(data) => this.connectionManager?.sendBinary(data) ?? false,
			() => this.getVaultId(),
			() => this.deviceId
		);

		//   
		this.connectionManager = new ConnectionManager(
			this.settings.serverUrl,
			this.settings.serverPort,
			this.deviceId,
			(message) => this.handleServerMessage(message),
			(connected) => this.updateConnectionState(connected)
		);

		//    
		this.startPeriodicCleanup();

		if (this.settings.enableSync) {
			this.connectToServer();
		}

		//    Vault ID   
		setTimeout(() => {
			this.checkInitialVaultIdSetup();
		}, 2000);
	}

	/**
	 *     
	 */
	onunload() {
		this.disconnectFromServer();
		this.syncManager?.dispose();
		this.cleanupResources();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	generateDeviceId(): string {
		return HashUtils.generateFileHash(`${navigator.userAgent}-${Date.now()}`);
	}

	/**
	 *    
	 */
	private updateConnectionState(connected: boolean): void {
		console.log('[SYNC-DEBUG] Connection state updated:', connected);
		this.updateStatusBar();
		
		if (connected) {
			//     
			console.log('[SYNC-DEBUG] Connection established, registering device');
			this.isDeviceRegistered = false;
			this.registerDevice();
			//      
		} else {
			console.log('[SYNC-DEBUG] Connection lost');
			this.isDeviceRegistered = false;
		}
	}

	/**
	 *   
	 */
	getConnectionState(): boolean {
		return this.connectionManager?.getConnectionState() ?? false;
	}

	/**
	 * Vault ID 
	 */
	getVaultId(): string {
		if (this.settings.vaultId && this.settings.vaultId.trim()) {
			return this.settings.vaultId.trim();
		}
		
		return this.extractVaultIdFromSystem();
	}

	/**
	 *   ID  
	 */
	extractVaultIdFromSystem(): string {
		const adapter = this.app.vault.adapter;
		
		if (adapter instanceof FileSystemAdapter) {
			const basePath = adapter.getBasePath();
			const pathParts = basePath.split(/[\/\\]/);
			return pathParts[pathParts.length - 1] || '';
		}
		
		try {
			const adapterName = adapter.getName();
			if (adapterName && adapterName !== 'DataAdapter' && adapterName !== 'CapacitorAdapter') {
				return adapterName;
			}
		} catch (error) {
			ErrorUtils.logError('extractVaultIdFromSystem', error);
		}
		
		return '';
	}

	/**
	 *      
	 */
	private checkInitialVaultIdSetup() {
		const vaultId = this.getVaultId();
		const autoExtracted = this.extractVaultIdFromSystem();
		
		if (!this.settings.vaultId && autoExtracted) {
			new Notice(`💡 Vault ID auto-detected as "${autoExtracted}" (you can change it in settings).`);
			this.settings.vaultId = autoExtracted;
			this.saveSettings();
			return;
		}
		
		if (!vaultId) {
			new Notice('⚠️ Auto Sync: Vault ID is not set. Please enter it in settings.', 8000);
		}
	}

	/**
	 * WebSocket  
	 */
	async connectToServer() {
		const validationResult = SettingsValidator.validateForConnection({
			serverUrl: this.settings.serverUrl,
			serverPort: this.settings.serverPort,
			vaultId: this.getVaultId()
		});

		if (!validationResult.canConnect) {
			new Notice(`❌ ${validationResult.message}`);
			this.settings.enableSync = false;
			this.saveSettings();
			this.updateStatusBar();
			return;
		}

		try {
			await this.connectionManager.connect();
		} catch (error) {
			ErrorUtils.logError('connectToServer', error);
			const userMessage = ErrorUtils.getUserFriendlyMessage(error, 'Server connection');
			new Notice(`❌ ${userMessage}`);
		}
	}

	/**
	 * WebSocket   
	 */
	disconnectFromServer() {
		this.connectionManager?.disconnect();
	}

	registerDevice() {
		if (!this.connectionManager?.getConnectionState()) return;

		const message = MessageFactory.createRegisterDeviceMessage({
			vaultId: this.getVaultId(),
			deviceId: this.deviceId,
			deviceName: this.settings.deviceName
		});

		console.log('[SYNC-DEBUG] Sending device registration:', JSON.stringify(message));
		this.connectionManager.sendMessage(message);
	}

	/**
	 *    
	 */
	async handleDeviceRegistrationResponse(message: RegisterDeviceResponseMessage) {
		console.log('[SYNC-DEBUG] Device registration response:', JSON.stringify(message));
		
		if (message.success) {
			this.isDeviceRegistered = true;
			new Notice('✅ Device registration successful');
			console.log('[SYNC-DEBUG] Device registered successfully, starting initial sync');
			
			//      
			await this.performInitialSync();
		} else {
			this.isDeviceRegistered = false;
			const errorMsg = message.message || 'Device registration failed';
			new Notice(`❌ ${errorMsg}`);
			console.error('[SYNC-DEBUG] Device registration failed:', errorMsg);
		}
	}

	async handleServerMessage(message: ServerMessage) {
		switch (message.type) {
			case 'register-device-response':
				await this.handleDeviceRegistrationResponse(message);
				break;
			case 'file-change':
			case 'binary-file-change':
				await this.handleRemoteFileChange(message);
				break;
			case 'file-delete':
				await this.handleRemoteFileDelete(message);
				break;
			case 'file-rename':
				await this.handleRemoteFileRename(message);
				break;
			case 'sync-response':
				await this.handleSyncResponse(message);
				break;
			case 'file-change-response':
				await this.handleFileChangeResponse(message);
				break;
			case 'chunk-upload-response':
				this.syncManager.handleChunkUploadResponse(message);
				break;
			case 'lock-acquired':
				console.log('Lock acquired for:', message.filePath);
				break;
			case 'lock-denied':
				console.log('Lock denied for:', message.filePath);
				break;
			case 'error':
				const errorMessage = ErrorUtils.getErrorMessage(message.message, 'Sync error occurred');
				new Notice(`❌ ${errorMessage}`);
				break;
		}
	}

	async handleRemoteFileChange(message: any) {
		if (message.deviceId === this.deviceId) {
			return;
		}

		const { filePath, content, hash, isBinary, size } = message;
		
		this.isRemoteSyncInProgress = true;
		try {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			
			if (file instanceof TFile) {
				//   
				if (isBinary) {
					//    
					const serverSize = size || HashUtils.base64ToArrayBuffer(content).byteLength;
					if (file.stat.size !== serverSize) {
						const newBuffer = HashUtils.base64ToArrayBuffer(content);
						await this.app.vault.modifyBinary(file, newBuffer);
						this.syncManager.updateServerHash(filePath, hash);
						new Notice(`Binary file synced: ${filePath}`);
					}
				} else {
					const currentContent = await this.app.vault.read(file);
					const currentHash = HashUtils.generateFileHash(currentContent);
					
					if (currentHash !== hash) {
						await this.app.vault.modify(file, content);
						this.syncManager.updateServerHash(filePath, hash);
						new Notice(`File synced: ${filePath}`);
					}
				}
			} else {
				//   
				await this.ensureDirectoryExists(filePath);
				
				if (isBinary) {
					const buffer = HashUtils.base64ToArrayBuffer(content);
					await this.app.vault.createBinary(filePath, buffer);
				} else {
					await this.app.vault.create(filePath, content);
				}
				
				this.syncManager.updateServerHash(filePath, hash);
				new Notice(`New ${isBinary ? 'binary ' : ''}file synced: ${filePath}`);
			}
		} catch (error) {
			ErrorUtils.logError('handleRemoteFileChange', error, { filePath });
			const userMessage = ErrorUtils.getUserFriendlyMessage(error, 'File sync');
			new Notice(`❌ ${userMessage}`);
		} finally {
			this.isRemoteSyncInProgress = false;
		}
	}

	async handleRemoteFileDelete(message: FileDeleteMessage) {
		if (message.deviceId === this.deviceId) {
			return;
		}

		const { filePath } = message;
		
		//    
		this.remoteOperationsInProgress.add(filePath);
		this.isRemoteSyncInProgress = true;
		
		try {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			
			if (file instanceof TFile) {
				await this.app.vault.delete(file);
				new Notice(`File deleted: ${filePath}`);
			}
		} catch (error) {
			ErrorUtils.logError('handleRemoteFileDelete', error, { filePath });
			const userMessage = ErrorUtils.getUserFriendlyMessage(error, 'File delete');
			new Notice(`❌ ${userMessage}`);
		} finally {
			this.remoteOperationsInProgress.delete(filePath);
			this.isRemoteSyncInProgress = false;
		}
	}

	async handleRemoteFileRename(message: FileRenameMessage) {
		if (message.deviceId === this.deviceId) {
			return;
		}

		const { oldPath, newPath } = message;
		
		//     (    )
		this.remoteOperationsInProgress.add(oldPath);
		this.remoteOperationsInProgress.add(newPath);
		this.isRemoteSyncInProgress = true;
		
		try {
			const file = this.app.vault.getAbstractFileByPath(oldPath);
			
			if (file instanceof TFile) {
				//     
				await this.ensureDirectoryExists(newPath);
				
				//   
				await this.app.vault.rename(file, newPath);
				
				//   
				this.syncManager.updateServerHash(newPath, this.syncManager.getKnownHash(oldPath) || '');
				
				new Notice(`File renamed: ${oldPath} → ${newPath}`);
			}
		} catch (error) {
			ErrorUtils.logError('handleRemoteFileRename', error, { oldPath, newPath });
			const userMessage = ErrorUtils.getUserFriendlyMessage(error, 'File rename');
			new Notice(`❌ ${userMessage}`);
		} finally {
			this.remoteOperationsInProgress.delete(oldPath);
			this.remoteOperationsInProgress.delete(newPath);
			this.isRemoteSyncInProgress = false;
		}
	}

	async handleSyncResponse(message: SyncResponseMessage) {
		const { files } = message;
		console.log(`[SYNC-DEBUG] Server response with ${files.length} files:`, JSON.stringify(files.slice(0, 3), null, 2));
		this.isRemoteSyncInProgress = true;
		try {
			//    
			for (const fileInfo of files) {
				this.serverFileList.add(fileInfo.path);
			}
			
			new Notice(`📥 Starting sync for ${files.length} files from server`);
			
			//     (  )
			const sortedFiles = files.sort((a, b) => {
				const sizeA = a.content ? a.content.length : 0;
				const sizeB = b.content ? b.content.length : 0;
				return sizeA - sizeB;
			});
			
			//    (  )
			const concurrentLimit = 5;
			const processFile = async (fileInfo: any) => {
				const { path, content, hash, isBinary, size } = fileInfo;
				const startTime = performance.now();
				const contentLength = content ? content.length : 0;
				console.log(`[SYNC-DEBUG] Processing file: ${path}, isBinary=${isBinary}, size=${size}, contentLength=${contentLength}, hash=${hash.substring(0,8)}`);
				
				try {
					const file = this.app.vault.getAbstractFileByPath(path);
					
					if (file instanceof TFile) {
						//     ( )
						const cachedHash = this.syncManager.getKnownHash(path);
						console.log(`[SYNC-DEBUG] File ${path}: cached=${cachedHash ? cachedHash.substring(0,8) : 'none'}, server=${hash.substring(0,8)}`);
						
						if (cachedHash === hash) {
							console.log(`[SYNC-DEBUG] File ${path} skipped (cache match) in ${performance.now() - startTime}ms`);
							return false; //  ,   
						}
						
						if (isBinary) {
							//       ( )
							const currentSize = file.stat.size;
							const newBuffer = HashUtils.base64ToArrayBuffer(content);
							const actualServerSize = newBuffer.byteLength;
							console.log(`[SYNC-DEBUG] Binary file ${path}: currentSize=${currentSize}, serverSize=${size}, actualContentSize=${actualServerSize}`);
							
							if (currentSize !== actualServerSize) {
								console.log(`[SYNC-DEBUG] Updating binary file ${path} (size mismatch: ${currentSize} -> ${actualServerSize})`);
								await this.app.vault.modifyBinary(file, newBuffer);
								this.syncManager.updateServerHash(path, hash);
								console.log(`[SYNC-DEBUG] Binary file ${path} updated in ${performance.now() - startTime}ms`);
								return true; // 
							}
						} else {
							const hashStartTime = performance.now();
							const currentContent = await this.app.vault.read(file);
							const currentHash = HashUtils.generateFileHash(currentContent);
							console.log(`[SYNC-DEBUG] Text file ${path}: hash calc took ${performance.now() - hashStartTime}ms, current=${currentHash.substring(0,8)}, server=${hash.substring(0,8)}`);
							
							if (currentHash !== hash) {
								console.log(`[SYNC-DEBUG] Updating text file ${path} (hash mismatch)`);
								await this.app.vault.modify(file, content);
								this.syncManager.updateServerHash(path, hash);
								console.log(`[SYNC-DEBUG] Text file ${path} updated in ${performance.now() - startTime}ms`);
								return true; // 
							}
						}
						
						//    
						this.syncManager.updateServerHash(path, hash);
						console.log(`[SYNC-DEBUG] File ${path} unchanged in ${performance.now() - startTime}ms`);
						return false; //  
					} else {
						//   
						console.log(`[SYNC-DEBUG] Creating new ${isBinary ? 'binary' : 'text'} file: ${path}`);
						await this.ensureDirectoryExists(path);
						
						if (isBinary) {
							const buffer = HashUtils.base64ToArrayBuffer(content);
							await this.app.vault.createBinary(path, buffer);
						} else {
							await this.app.vault.create(path, content);
						}
						
						this.syncManager.updateServerHash(path, hash);
						console.log(`[SYNC-DEBUG] New file ${path} created in ${performance.now() - startTime}ms`);
						return true; //   
					}
				} catch (error) {
					ErrorUtils.logError('handleSyncResponse', error, { filePath: path });
					return false;
				}
			};
			
			//   ( )
			let updatedCount = 0;
			let processedCount = 0;
			const totalFiles = files.length;
			
			for (let i = 0; i < totalFiles; i += concurrentLimit) {
				const chunk = sortedFiles.slice(i, i + concurrentLimit);
				
				const results = await Promise.allSettled(
					chunk.map(fileInfo => processFile(fileInfo))
				);
				
				//    
				updatedCount += results.filter(result => 
					result.status === 'fulfilled' && result.value
				).length;
				
				processedCount += chunk.length;
			}
			
			new Notice(`📥 Server sync completed: ${updatedCount} files updated (out of ${totalFiles})`);
		
		//  →    ,    
		this.syncMissingLocalFiles().finally(() => {
			this.isRemoteSyncInProgress = false;
		});
		
		} finally {
			// syncMissingLocalFiles   
		}
	}

	async handleFileChangeResponse(message: FileChangeResponseMessage) {
		const { filePath, success, serverHash } = message;
		
		if (success && serverHash) {
			this.syncManager.updateServerHash(filePath, serverHash);
		}
	}

	async onFileModified(file: TAbstractFile) {
		if (!(file instanceof TFile) || !this.settings.enableSync || !this.getConnectionState() || this.isRemoteSyncInProgress) {
			return;
		}

		this.syncManager.scheduleSync(file);
	}

	async onFileCreated(file: TAbstractFile) {
		if (!(file instanceof TFile) || !this.settings.enableSync || !this.getConnectionState() || this.isRemoteSyncInProgress) {
			return;
		}

		this.syncManager.scheduleSync(file);
	}

	async onFileDeleted(file: TAbstractFile) {
		if (!this.settings.enableSync || !this.getConnectionState() || this.isRemoteSyncInProgress || this.remoteOperationsInProgress.has(file.path)) {
			return;
		}

		this.syncManager.syncFileDelete(file.path);
	}

	async onFileRenamed(file: TAbstractFile, oldPath: string) {
		if (!(file instanceof TFile) || !this.settings.enableSync || !this.getConnectionState() || this.isRemoteSyncInProgress || 
			this.remoteOperationsInProgress.has(oldPath) || this.remoteOperationsInProgress.has(file.path)) {
			return;
		}

		//  rename :   
		this.syncManager.syncFileRename(oldPath, file.path);
	}

	/**
	 *     
	 */
	async ensureDirectoryExists(filePath: string) {
		const pathParts = filePath.split('/');
		pathParts.pop(); //  
		
		if (pathParts.length === 0) {
			return;
		}
		
		let currentPath = '';
		for (const part of pathParts) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			
			try {
				const folder = this.app.vault.getAbstractFileByPath(currentPath);
				if (!folder) {
					await this.app.vault.createFolder(currentPath);
				}
			} catch (error) {
				//     ,   
				const errorMessage = ErrorUtils.getErrorMessage(error);
				if (!errorMessage.includes('already exists') && !errorMessage.includes('EEXIST')) {
					ErrorUtils.logError('ensureDirectoryExists', error, { currentPath });
				}
			}
		}
	}

	/**
	 *   
	 */
	async performInitialSync() {
		console.log('[SYNC-DEBUG] performInitialSync called');
		if (!this.getConnectionState()) {
			console.log('[SYNC-DEBUG] Not connected, skipping initial sync');
			return;
		}

		if (!this.isDeviceRegistered) {
			console.log('[SYNC-DEBUG] Device not registered, skipping initial sync');
			return;
		}

		console.log('[SYNC-DEBUG] Connected and registered, starting initial sync');
		new Notice('🔄 Fetching file list from server...');
		
		try {
			//    
			this.serverFileList.clear();
			
			//    
			const message = MessageFactory.createSyncRequestMessage({
				vaultId: this.getVaultId(),
				deviceId: this.deviceId
			});
			
			console.log('[SYNC-DEBUG] Sending sync request:', JSON.stringify(message));
			const result = this.connectionManager.sendMessage(message);
			console.log('[SYNC-DEBUG] Sync request sent result:', result);
			
			//        
			// handleSyncResponse syncMissingLocalFiles  
			
		} catch (error) {
			console.error('[SYNC-DEBUG] performInitialSync error:', error);
			ErrorUtils.logError('performInitialSync', error);
			const userMessage = ErrorUtils.getUserFriendlyMessage(error, 'Initial sync');
			new Notice(`❌ ${userMessage}`);
		}
	}

	/**
	 *     
	 */
	async syncMissingLocalFiles() {
		if (!this.getConnectionState()) {
			return;
		}

		try {
			const allFiles = this.app.vault.getAllLoadedFiles();
			
			const localFiles = allFiles.filter(file => {
				return file instanceof TFile && !FileUtils.shouldIgnoreFile(file.path);
			}) as TFile[];
			
			//    
			const missingFiles = localFiles.filter(file => {
				return !this.serverFileList.has(file.path);
			});
			
			if (missingFiles.length === 0) {
				new Notice('✅ Initial sync complete: no additional local files to upload');
				return;
			}
			
			new Notice(`📤 Uploading ${missingFiles.length} local files missing on server`);
			
			//   
			for (const file of missingFiles) {
				this.syncManager.addToBatchAndProcess(file);
			}
			
			//    
			await this.syncManager.processBatchImmediate();
			
			new Notice(`✅ Initial sync complete: uploaded ${missingFiles.length} files`);
		} catch (error) {
			ErrorUtils.logError('syncMissingLocalFiles', error);
			const userMessage = ErrorUtils.getUserFriendlyMessage(error, 'Local file sync');
			new Notice(`❌ ${userMessage}`);
		}
	}

	/**
	 *      ( )
	 */
	async syncAllLocalFiles() {
		if (!this.getConnectionState()) {
			return;
		}

		try {
			const allFiles = this.app.vault.getAllLoadedFiles();
			const files = allFiles.filter(file => {
				return file instanceof TFile && !FileUtils.shouldIgnoreFile(file.path);
			}) as TFile[];
			
			for (const file of files) {
				this.syncManager.addToBatch(file);
			}

			new Notice(`🔄 Force sync: processing ${files.length} files`);
		} catch (error) {
			ErrorUtils.logError('syncAllLocalFiles', error);
			const userMessage = ErrorUtils.getUserFriendlyMessage(error, 'Local file sync');
			new Notice(`❌ ${userMessage}`);
		}
	}

	/**
	 *  
	 */
	updateStatusBar() {
		if (!this.syncStatusBar) return;

		const isConnected = this.getConnectionState();
		const status = this.settings.enableSync 
			? (isConnected ? '🟢 Sync' : '🟡 Sync') 
			: '⭕ Sync';
		
		this.syncStatusBar.setText(status);
	}

	/**
	 *   
	 */
	toggleSync() {
		if (!this.settings.enableSync) {
			const validationResult = SettingsValidator.validateForConnection({
				serverUrl: this.settings.serverUrl,
				serverPort: this.settings.serverPort,
				vaultId: this.getVaultId()
			});

			if (!validationResult.canConnect) {
				new Notice(`❌ ${validationResult.message}`);
				return;
			}
		}

		this.settings.enableSync = !this.settings.enableSync;
		this.saveSettings();

		if (this.settings.enableSync) {
			this.connectToServer();
		} else {
			this.disconnectFromServer();
		}

		this.updateStatusBar();
		new Notice(`Auto sync ${this.settings.enableSync ? 'enabled' : 'disabled'}`);
	}

	/**
	 *    
	 */
	async forceSyncAll() {
		if (!this.getConnectionState()) {
			new Notice('Not connected to sync server');
			return;
		}

		const message = MessageFactory.createSyncRequestMessage({
			vaultId: this.getVaultId(),
			deviceId: this.deviceId
		});

		this.connectionManager.sendMessage(message);
		new Notice('Force sync requested');
	}

	/**
	 *    
	 */
	private startPeriodicCleanup() {
		this.cleanupInterval = setInterval(() => {
			this.performPeriodicCleanup();
		}, 5 * 60 * 1000);
	}

	/**
	 *    
	 */
	private performPeriodicCleanup() {
		this.syncManager?.cleanup();

		if (!this.getConnectionState() && this.settings.enableSync) {
			console.log('Attempting reconnection due to periodic cleanup');
			this.connectToServer();
		}
	}

	/**
	 *   
	 */
	private cleanupResources() {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		this.disconnectFromServer();
	}
}

class AutoSyncSettingTab extends PluginSettingTab {
	plugin: AutoSyncPlugin;

	constructor(app: App, plugin: AutoSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();
		containerEl.createEl('h2', {text: 'Auto Sync Settings'});

		new Setting(containerEl)
			.setName('Server URL')
			.setDesc('The URL of your sync server')
			.addText(text => text
				.setPlaceholder('10.0.0.1')
				.setValue(this.plugin.settings.serverUrl)
				.onChange(async (value) => {
					this.plugin.settings.serverUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Server Port')
			.setDesc('The WebSocket port of your sync server')
			.addText(text => text
				.setPlaceholder('3001')
				.setValue(this.plugin.settings.serverPort.toString())
				.onChange(async (value) => {
					this.plugin.settings.serverPort = parseInt(value) || 3001;
					await this.plugin.saveSettings();
				}));

		const autoExtractedId = this.plugin.extractVaultIdFromSystem();
		const vaultIdDesc = autoExtractedId 
			? `Auto-detected ID: "${autoExtractedId}" (manual input overrides auto-detection)`
			: 'Auto-detection failed. Enter a unique vault identifier (e.g., MyVault).';
		
		new Setting(containerEl)
			.setName('Vault ID')
			.setDesc(vaultIdDesc)
			.addText(text => text
				.setPlaceholder(autoExtractedId || 'Enter vault ID')
				.setValue(this.plugin.settings.vaultId)
				.onChange(async (value) => {
					const validationResult = SettingsValidator.validateVaultId(value);
					if (!validationResult.valid && validationResult.error) {
						new Notice(`❌ ${validationResult.error}`);
						return;
					}
					
					this.plugin.settings.vaultId = value.trim();
					await this.plugin.saveSettings();
					
					if (value.trim() && this.plugin.settings.enableSync) {
						this.plugin.connectToServer();
					}
				}));

		new Setting(containerEl)
			.setName('Device Name')
			.setDesc('A friendly name for this device')
			.addText(text => text
				.setPlaceholder('My Device')
				.setValue(this.plugin.settings.deviceName)
				.onChange(async (value) => {
					this.plugin.settings.deviceName = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable Auto Sync')
			.setDesc('Enable automatic synchronization')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableSync)
				.onChange(async (value) => {
					if (value) {
						const validationResult = SettingsValidator.validateForConnection({
							serverUrl: this.plugin.settings.serverUrl,
							serverPort: this.plugin.settings.serverPort,
							vaultId: this.plugin.getVaultId()
						});

						if (!validationResult.canConnect) {
							new Notice(`❌ ${validationResult.message}`);
							toggle.setValue(false);
							return;
						}
					}

					this.plugin.settings.enableSync = value;
					await this.plugin.saveSettings();
					
					if (value) {
						this.plugin.connectToServer();
					} else {
						this.plugin.disconnectFromServer();
					}
					this.plugin.updateStatusBar();
				}));

		new Setting(containerEl)
			.setName('Sync Interval (ms)')
			.setDesc('Delay before syncing changes (to batch rapid edits)')
			.addText(text => text
				.setPlaceholder('1000')
				.setValue(this.plugin.settings.syncInterval.toString())
				.onChange(async (value) => {
					this.plugin.settings.syncInterval = parseInt(value) || 1000;
					await this.plugin.saveSettings();
				}));

		const statusEl = containerEl.createDiv();
		statusEl.createEl('h3', {text: 'Connection Status'});
		const connectionStatus = statusEl.createEl('p');
		
		const updateStatus = () => {
			const status = this.plugin.getConnectionState() ? '🟢 Connected' : '🔴 Disconnected';
			const deviceInfo = `Device ID: ${this.plugin.deviceId.substring(0, 12)}...`;
			connectionStatus.innerHTML = `${status}<br>${deviceInfo}`;
		};
		
		updateStatus();
		setInterval(updateStatus, 1000);

		new Setting(containerEl)
			.setName('Force Sync')
			.setDesc('Manually trigger a full synchronization')
			.addButton(button => button
				.setButtonText('Sync Now')
				.onClick(() => {
					this.plugin.forceSyncAll();
				}));
	}
}
