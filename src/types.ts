export interface PollingConnectionConfig {
    targetAppId: string
    targetAppBaseUrl: string
    reverseProxyBaseUrl: string
    exclude?: boolean
}

export type FowardRequestCallback = (error: Error | null, response: any) => void;

export interface PendingTransfer {
    id: string
    path: string
    method: string
    headers: string[]
    resBody: NodeJS.ReadableStream | null
}

export interface PollRequest {
    backendId: string
}

export interface PendingTransferKey {
    backendId: string
    id: string
}

export interface PendingTransferAction extends PendingTransferKey {
    error?: string
}

export interface ResponseHeadersNotification extends PendingTransferKey {
    statusCode: number
    statusMessage: string
    headers: Record<string, string[]>
}

export interface FailureNotification extends PendingTransferKey {
    remoteTimeout?: boolean
    error?: string
}