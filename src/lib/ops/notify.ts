/** Notification system — DISABLED. Abra retired. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type NotifyChannel = "slack" | "sms" | "imessage";
export type NotifyOpts = any;
export async function notify(_opts: any): Promise<any> { return { slack: false, sms: false, imessage: false }; }
export async function notifyAlert(_text: string, ..._rest: any[]): Promise<boolean> { return false; }
export async function notifyPipeline(_text: string): Promise<boolean> { return false; }
export async function notifyDaily(_text: string): Promise<boolean> { return false; }
export async function textBen(_text: string): Promise<boolean> { return false; }
