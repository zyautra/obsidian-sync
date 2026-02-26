import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

export class MockWebSocket extends EventEmitter {
  url: string;
  readyState: number = 1;
  OPEN: number = 1;
  CLOSED: number = 3;
  
  // Event handler properties
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  
  static OPEN: number = 1;
  static CLOSED: number = 3;
  
  constructor(url: string) {
    super();
    this.url = url;
    
    //   URL   
    if (url.includes('invalid-url')) {
      //  
      setTimeout(() => {
        this.simulateError(new Error('WebSocket connection failed'));
      }, 10);
    } else {
      //   
      setTimeout(() => {
        this.simulateOpen();
      }, 10);
    }
  }
  
  send = jest.fn((data: string) => {
    //  
  });
  
  close = jest.fn(() => {
    this.readyState = this.CLOSED;
    this.removeAllListeners();
  });
  
  removeAllListeners = jest.fn((event?: string | symbol) => {
    super.removeAllListeners(event);
    return this;
  });
  
  simulateOpen() {
    this.readyState = this.OPEN;
    const event = new Event('open') as any;
    this.onopen?.(event);
    this.emit('open', event);
  }
  
  simulateClose(code: number = 1000) {
    this.readyState = this.CLOSED;
    const event = { code, reason: '', wasClean: true } as CloseEvent;
    this.onclose?.(event);
    this.emit('close', event);
  }
  
  simulateMessage(data: any) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    this.onmessage?.(event);
    this.emit('message', event);
  }
  
  simulateError(error: Error) {
    const event = new Event('error') as any;
    event.error = error;
    
    // onerror   
    if (this.onerror) {
      this.onerror(event);
    }
    
    // EventEmitter    emit
    if (this.listenerCount('error') > 0) {
      this.emit('error', event);
    }
  }
}

export default MockWebSocket;