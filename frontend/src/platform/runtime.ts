// Stub — native platform runtime not active in web build
export function isNativeApp(): boolean { return false; }
export function getNativePlugin<T = unknown>(_name: string): T | null { return null; }
export function getRuntimePlatform(): string { return 'web'; }
