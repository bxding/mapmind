/** Only these deliberately authored messages may cross the public API boundary. */
export class ServiceError extends Error {
	constructor(readonly code: string, message: string) { super(message); this.name = 'ServiceError'; }
}
