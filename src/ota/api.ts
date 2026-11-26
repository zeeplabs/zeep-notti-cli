import { CliError } from '../errors.js';

export type FetchFn = typeof fetch;

export interface UploadTicket {
  upload_id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  max_bytes: number;
}

export interface CreateReleaseBody {
  upload_id: string;
  manifest: string;
  signature: string;
  key_id: string;
  channel: string;
  rollout_percent?: number;
  mandatory?: boolean;
}

export interface Release {
  id: string;
  platform: string;
  channel: string;
  runtime_version: string;
  rollout_percent: number;
  mandatory: boolean;
}

export interface ApiOptions {
  baseUrl: string;
  appId: string;
  apiKey: string;
  fetch: FetchFn;
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: { limit?: number; resets_at?: string };
  };
}

/** Client for the Live updates management API, authenticated with the App's REST key. */
export class LiveUpdatesApi {
  constructor(private readonly opts: ApiOptions) {}

  listKeys(): Promise<Array<{ key_id: string }>> {
    return this.request('GET', 'keys');
  }

  createUpload(): Promise<UploadTicket> {
    return this.request('POST', 'uploads');
  }

  createRelease(body: CreateReleaseBody): Promise<Release> {
    return this.request('POST', 'releases', body);
  }

  /** PUTs the archive to the presigned URL with the signed headers, never the API key. */
  async uploadArchive(ticket: UploadTicket, data: Buffer): Promise<void> {
    let response: Response;
    try {
      response = await this.opts.fetch(ticket.url, {
        method: ticket.method || 'PUT',
        headers: { 'Cache-Control': 'private', ...ticket.headers },
        body: new Uint8Array(data),
      });
    } catch (err) {
      throw new CliError(
        `network_error: the archive upload failed: ${(err as Error).message}`
      );
    }
    if (!response.ok) {
      throw new CliError(
        `upload_failed: storage answered HTTP ${response.status} to the archive upload`
      );
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const base = this.opts.baseUrl.replace(/\/+$/, '');
    const url = `${base}/v1/apps/${encodeURIComponent(this.opts.appId)}/ota/${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      Accept: 'application/json',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await this.opts.fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new CliError(
        `network_error: could not reach ${base}: ${(err as Error).message}`
      );
    }

    const text = await response.text();
    if (!response.ok) {
      throw apiError(response.status, text);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new CliError(
        `invalid_response: ${method} ${path} answered HTTP ${response.status} without JSON`
      );
    }
  }
}

function apiError(status: number, text: string): CliError {
  let envelope: ErrorEnvelope = {};
  try {
    envelope = JSON.parse(text) as ErrorEnvelope;
  } catch {
    // Not a Notti error envelope; fall back to the HTTP status below.
  }
  const code = envelope.error?.code;
  if (!code) {
    return new CliError(`http_${status}: unexpected response from the server`);
  }
  let message = `${code}: ${envelope.error?.message ?? ''}`.trimEnd();
  const details = envelope.error?.details;
  if (details?.limit !== undefined && details.resets_at) {
    message += ` (limit ${details.limit}, resets at ${details.resets_at})`;
  }
  return new CliError(message);
}
