import { jest } from '@jest/globals';

export class FileSystemAdapter {
  getName() {
    return 'FileSystemAdapter';
  }
  
  getBasePath() {
    return '/mock/path';
  }
}

export class DataAdapter {
  getName() {
    return 'DataAdapter';
  }
}

export class TAbstractFile {
  path: string;
  name: string;
  vault: any;
  parent: any;
  
  constructor(path: string) {
    this.path = path;
    this.name = path.split('/').pop() || '';
    this.vault = null;
    this.parent = null;
  }
}

export class TFile extends TAbstractFile {
  extension: string;
  basename: string;
  stat: {
    ctime: number;
    mtime: number;
    size: number;
  };
  
  constructor(path: string, size: number = 1024) {
    super(path);
    this.extension = this.name.split('.').pop() || '';
    this.basename = this.name.replace(`.${this.extension}`, '');
    this.stat = {
      ctime: Date.now(),
      mtime: Date.now(),
      size: size
    };
  }
}

export class Notice {
  constructor(message: string) {
    console.log('Notice:', message);
  }
}

export class Plugin {
  app: any;
  manifest: any;
  
  constructor(app: any, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }
  
  addRibbonIcon = jest.fn();
  addCommand = jest.fn();
  addSettingTab = jest.fn();
  addStatusBarItem = jest.fn(() => ({
    setText: jest.fn()
  }));
  registerEvent = jest.fn(() => ({
    unregister: jest.fn()
  }));
  loadData = jest.fn(() => Promise.resolve({}));
  saveData = jest.fn(() => Promise.resolve());
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: any;
  
  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = {
      empty: jest.fn(),
      createEl: jest.fn((tag: string, options?: any) => ({
        setText: jest.fn(),
        innerHTML: ''
      })),
      createDiv: jest.fn(() => ({
        createEl: jest.fn((tag: string, options?: any) => ({
          innerHTML: ''
        }))
      }))
    };
  }
}

export class Setting {
  constructor(containerEl: any) {
    return {
      setName: jest.fn(() => this),
      setDesc: jest.fn(() => this),
      addText: jest.fn((callback: any) => {
        callback({
          setPlaceholder: jest.fn(() => this),
          setValue: jest.fn(() => this),
          onChange: jest.fn(() => this)
        });
        return this;
      }),
      addToggle: jest.fn((callback: any) => {
        callback({
          setValue: jest.fn(() => this),
          onChange: jest.fn(() => this)
        });
        return this;
      }),
      addButton: jest.fn((callback: any) => {
        callback({
          setButtonText: jest.fn(() => this),
          onClick: jest.fn(() => this)
        });
        return this;
      })
    };
  }
}

export class App {
  keymap: any = {};
  scope: any = {};
  workspace: any = {};
  metadataCache: any = {};
  fileManager: any = {};
  lastEvent: any = null;
  plugins: any = {};
  setting: any = {};
  loadLocalStorage = jest.fn();
  saveLocalStorage = jest.fn();

  vault = {
    on: jest.fn((eventName: string, callback: Function) => ({
      unregister: jest.fn()
    })),
    read: jest.fn(() => Promise.resolve('test content')),
    readBinary: jest.fn(() => Promise.resolve(new ArrayBuffer(8))),
    modify: jest.fn(() => Promise.resolve()),
    modifyBinary: jest.fn(() => Promise.resolve()),
    create: jest.fn(() => Promise.resolve()),
    createBinary: jest.fn(() => Promise.resolve()),
    createFolder: jest.fn(() => Promise.resolve()),
    delete: jest.fn(() => Promise.resolve()),
    rename: jest.fn(() => Promise.resolve()),
    getAbstractFileByPath: jest.fn((path: string) => {
      if (path && path.endsWith('.md')) {
        return new TFile(path);
      }
      return null;
    }),
    getMarkdownFiles: jest.fn(() => []),
    getAllLoadedFiles: jest.fn(() => []),
    adapter: new FileSystemAdapter()
  };
}