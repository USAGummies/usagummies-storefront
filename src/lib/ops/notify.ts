/** Notification system — DISABLED. Abra retired. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function notify(_opts: any): Promise<any> { return { slack: false, sms: false, imessage: false }; }
export async function notifyAlert(_text: string): Promise<boolean> { return false; }
export async function notifyPipeline(_text: string): Promise<boolean> { return false; }
export async function notifyDaily(_text: string): Promise<boolean> { return false; }
