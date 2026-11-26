// Filament DB adapter: printing belongs to the host app, never the sandbox.
export class USBTransport {
 static getShared() {return new USBTransport();}
 static isAvailable() {return false;}
 async tryReconnect() {return false;}
 async connect() {throw new Error('Use Filament DB printer controls');}
 async disconnect() {}
 isConnected() {return false;}
}
