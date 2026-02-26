/**
 *    
 * 
 *   ,  ,       .
 */
export class FileUtils {
  /**
   *   
   *    /  .
   * 
   * @param filePath  
   * @returns   
   */
  static isTextFile(filePath: string): boolean {
    const textExtensions = [
      '.md', '.txt', '.json', '.css', '.js', '.ts', '.html', '.xml', '.svg',
      '.csv', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
      '.log', '.py', '.java', '.cpp', '.c', '.h', '.php', '.rb',
      '.go', '.rs', '.swift', '.kt', '.dart', '.sh', '.bat',
      '.canvas' // Obsidian Canvas 
    ];
    
    const ext = filePath.toLowerCase().substring(filePath.lastIndexOf('.'));
    return textExtensions.includes(ext);
  }

  /**
   *    
   *  ,  ,    .
   * 
   * @param filePath  
   * @returns   
   */
  static shouldIgnoreFile(filePath: string): boolean {
    const fileName = filePath.toLowerCase();
    
    //  
    const tempPatterns = [
      /\.tmp$/,           // .tmp 
      /\.swp$/,           // Vim  
      /\.swo$/,           // Vim   
      /~$/,               //   (~)
      /\.bak$/,           // .bak  
      /\.lock$/,          //  
      /\.DS_Store$/,      // macOS  
      /^\.#/,             // Emacs  
      /#.*#$/,            // Emacs  
      /\.autosave$/,      //  
    ];

    //  
    const systemDirs = [
      '.obsidian',        // Obsidian  
      '.git',             // Git 
      'node_modules',     // Node.js 
      '.vscode',          // VS Code 
    ];

    //    
    if (tempPatterns.some(pattern => pattern.test(fileName))) {
      return true;
    }

    //   
    if (systemDirs.some(dir => filePath.startsWith(dir + '/') || filePath === dir)) {
      return true;
    }

    //   (  )
    const pathParts = filePath.split('/');
    if (pathParts.some(part => part.startsWith('.') && part !== '.' && part !== '..')) {
      // , .md   (Obsidian   )
      if (!fileName.endsWith('.md')) {
        return true;
      }
    }

    return false;
  }

  /**
   *     
   * 
   * @param filePath  
   * @returns   
   */
  static getDirectoryPaths(filePath: string): string[] {
    const pathParts = filePath.split('/');
    pathParts.pop(); //  
    
    if (pathParts.length === 0) {
      return []; //    
    }
    
    const directories: string[] = [];
    let currentPath = '';
    
    for (const part of pathParts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      directories.push(currentPath);
    }
    
    return directories;
  }

  /**
   *       
   * 
   * @param fileSize   ()
   * @param baseDelay    ()
   * @returns   
   */
  static calculateDebounceDelay(fileSize: number, baseDelay: number = 1000): number {
    const sizeKB = fileSize / 1024;
    let sizeMultiplier = 1;
    
    if (sizeKB > 100) {      // 100KB 
      sizeMultiplier = 2;
    } else if (sizeKB > 500) {  // 500KB 
      sizeMultiplier = 3;
    } else if (sizeKB > 1024) { // 1MB 
      sizeMultiplier = 4;
    }
    
    return Math.min(Math.max(baseDelay * sizeMultiplier, 200), 10000);
  }

  /**
   *       
   * 
   * @param filePath  
   * @param baseDelay    ()
   * @returns   
   */
  static calculateTypeBasedDelay(filePath: string, baseDelay: number = 1000): number {
    const fileName = filePath.toLowerCase();
    let typeMultiplier = 1;
    
    if (fileName.endsWith('.md')) {
      //  :  
      typeMultiplier = 0.5;
    } else if (fileName.match(/\.(txt|json|yaml|yml)$/)) {
      //  :  
      typeMultiplier = 1;
    } else if (fileName.match(/\.(js|ts|py|java|cpp|c|h)$/)) {
      //  :   ( )
      typeMultiplier = 1.5;
    } else if (fileName.match(/\.(pdf|doc|docx|xls|xlsx)$/)) {
      //  : 
      typeMultiplier = 2;
    } else if (fileName.match(/\.(jpg|jpeg|png|gif|bmp|svg)$/)) {
      //  :  
      typeMultiplier = 3;
    } else if (fileName.match(/\.(mp4|avi|mov|mp3|wav)$/)) {
      //  :  
      typeMultiplier = 5;
    }
    
    return Math.min(Math.max(baseDelay * typeMultiplier, 200), 10000);
  }

  /**
   *      
   *     .
   * 
   * @param filePath  
   * @param fileSize   ()
   * @param baseDelay    ()
   * @returns    
   */
  static calculateOptimalDebounceDelay(filePath: string, fileSize: number, baseDelay: number = 1000): number {
    const sizeDelay = this.calculateDebounceDelay(fileSize, baseDelay);
    const typeDelay = this.calculateTypeBasedDelay(filePath, baseDelay);
    
    //       (  )
    return Math.max(sizeDelay, typeDelay);
  }
}