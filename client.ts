const FSHARE_APP_KEY = Deno.env.get("FSHARE_APP_KEY") || "";
const API_URL = "https://api.fshare.vn/api";

const authResponse = new Response("401 Unauthorized", {
  status: 401,
  statusText: "Unauthorized",
  headers: {
    "WWW-Authenticate": `Basic realm="Login", charset="UTF-8"`,
  },
});

export interface FShareClient {
  login(): Promise<Response>;
  download(url: string | URL, init?: RequestInit): Promise<Response>;
  upload(url: string | URL, init?: RequestInit): Promise<Response>;
}

export class Client implements FShareClient {
  #headers: Headers;
  #token: string;

  /**
   * Creates FShare client and logs in.
   */
  static async connect(username: string, password: string): Promise<Client> {
    const client = new Client({
      headers: {
        Authorization: `Basic ${btoa(`${username}:${password}`)}`,
      },
    });

    await client.login();

    return client;
  }

  constructor(init: RequestInit) {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    if (!headers.has("User-Agent")) {
      headers.set("User-Agent", "fshare-deno");
    }
    this.#headers = headers;
    this.#token = "";
  }

  async login(): Promise<Response> {
    const headers = this.#headers;
    const authorization = headers.get("Authorization");

    if (!authorization) {
      return authResponse;
    }

    const [, base64 = ""] = authorization.match(/^Basic\s+(.*)$/) || [];
    const [user_email, password] = atob(base64).split(":");

    const response = await fetch(`${API_URL}/user/login`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        app_key: FSHARE_APP_KEY,
        user_email,
        password,
      }),
      credentials: "same-origin",
    });

    const { code, msg, token, session_id } = await response.json();

    if (!token) {
      return authResponse;
    }

    this.#token = token;
    headers.set("Cookie", `session_id=${session_id};`);

    return new Response(null, {
      status: code,
      statusText: msg,
    });
  }

  /**
   * Downloads a file from FShare URL.
   *
   * A full URL is required, e.g. https://www.fshare.vn/file/XXXXXXXXXX, or
   * just the file ID, e.g. XXXXXXXXXX. An optional `init` object can be passed
   * to customize the request.
   *
   * Similar to a regular `fetch`, if `init.redirect` is set to `manual`, the
   * response is empty with the direct download link in `Location` header.
   * Otherwise, the response is a `ReadableStream` of the file content.
   *
   * ```ts
   * import { Client } from "./client.ts";
   * const client = await Client.connect("user", "pass");
   *
   * let response = await client.download("XXXXXXXXXX");
   * await response.body!.pipeTo(Deno.stdout.writable);
   *
   * response = await client.download("https://www.fshare.vn/file/XXXXXXXXXX");
   * await response.body!.pipeTo(Deno.stdout.writable);
   *
   * response = await client.download("XXXXXXXXXX", { redirect: "manual" });
   * console.log(response.headers.get("Location"));
   * ```
   */
  async download(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(this.#headers);
    let token = this.#token;

    if (!token) {
      const response = await this.login();
      if (!response.ok) {
        return response;
      }
      token = this.#token;
    }

    // Clears "Authorization" header before passing to fetch.
    headers.delete("Authorization");

    url = new URL(url, "https://www.fshare.vn/file/");
    const password = url.searchParams.get("password");
    url.searchParams.delete("password");

    const {
      method = "POST",
      redirect = "follow",
    } = init;

    const response = await fetch(`${API_URL}/session/download`, {
      method,
      headers,
      body: JSON.stringify({
        url,
        token,
        password,
      }),
    });

    const { location } = await response.json();

    if (!location) {
      return authResponse;
    }

    if (redirect === "manual") {
      return Response.redirect(location, 303);
    }
    if (redirect === "error") {
      throw new Error(`Redirected to ${location}`);
    }

    return fetch(location, {
      method: "GET",
      headers,
    });
  }

  /**
   * Uploads a file to FShare.
   *
   * The target path to the file on FShare is required, e.g. /folder/file.txt.
   * The file's body must be passed in `init.body`. The file's size must be
   * passed in `init.headers["Content-Length"]`.
   *
   * Similar to a regular `fetch`, if `init.redirect` is set to `manual`, the
   * response is empty with the direct upload link in `Location` header.
   * Otherwise, the response contains a JSON information of the new file.
   *
   * ```ts
   * import { Client } from "./client.ts";
   * const client = await Client.connect("user", "pass");
   *
   * let response = await client.upload("/folder/file.txt", {
   *   headers: {
   *     "Content-Length": "123",
   *   },
   *   body: Deno.stdin.readable,
   * });
   * console.log(await response.json());
   *
   * response = await client.upload("/folder/file.txt", {
   *   headers: {
   *     "Content-Length": "123",
   *   },
   *   body: Deno.stdin.readable,
   *   redirect: "manual",
   * });
   * console.log(response.headers.get("Location"));
   * ```
   */
  async upload(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(this.#headers);
    let token = this.#token;
    if (!token) {
      const response = await this.login();
      if (!response.ok) {
        return response;
      }
      token = this.#token;
    }

    // Clears "Authorization" header before passing to fetch.
    headers.delete("Authorization");

    const { pathname } = new URL(url, "https://www.fshare.vn/");
    const segments = pathname.split("/");
    const name = segments.pop();
    const path = "/" + segments.join("/");

    const {
      method = "POST",
      redirect = "follow",
      headers: headersInit,
      body,
    } = init;

    const size = Number(new Headers(headersInit).get("Content-Length"));

    let response = await fetch(`${API_URL}/session/upload`, {
      method,
      headers,
      body: JSON.stringify({
        name,
        size: `${size}`,
        path,
        token,
        /** @TODO let the user pass this in. */
        secured: 1, // 1: private, 0: public
      }),
    });

    const { location } = await response.json();

    if (!location) {
      return authResponse;
    }

    if (redirect === "manual") {
      return Response.redirect(location, 303);
    }
    if (redirect === "error") {
      throw new Error(`Redirected to ${location}`);
    }

    const chunkSize = 65536 * 1024 / 4; // 16MB
    const chunks = Math.ceil(size / chunkSize);
    console.info(
      `Uploading ${chunks} chunks of approximately ${chunkSize} bytes each...`,
    );

    let start = 0;
    for await (
      const chunk of iterateStream(body as ReadableStream, {
        bufSize: chunkSize,
      })
    ) {
      const end = start + chunk.byteLength;
      const range = `${start}-${end - 1}/${size}`;
      start = end;
      response = await fetch(location, {
        method: "POST",
        headers: {
          ...headers,
          "Accept": "*/*",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
          "Content-Length": `${chunk.byteLength}`,
          "Content-Range": `bytes ${range}`,
          "Connection": "keep-alive",
        },
        body: chunk,
      });

      if (response.ok) {
        console.info(`Uploaded chunk ${range}`);
      }
    }

    return response;
  }
}

/**
 * Iterates over a ReadableStream, yielding chunks of data.
 *
 * ```ts
 * const response = await fetch("https://example.com");
 * for await (const chunk of iterateStream(response.body)) {
 *   console.log(chunk);
 * }
 * ```
 */
async function* iterateStream(stream: ReadableStream, options?: {
  bufSize?: number;
}) {
  const reader = stream.getReader();
  const bufSize = options?.bufSize ?? 65_536;

  const emptyArray = new Uint8Array(0);
  let buffer = emptyArray;

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      // Yield the last chunk.
      if (buffer.byteLength > 0) {
        yield buffer;
      }
      break;
    }

    // Constructs a new buffer to hold all the data so far.
    const chunk = new Uint8Array(buffer.byteLength + value.byteLength);
    chunk.set(buffer, 0);
    chunk.set(value, buffer.byteLength);

    if (chunk.byteLength >= bufSize) {
      yield chunk;
      // Reset the buffer.
      buffer = emptyArray;
    } else {
      buffer = chunk;
    }
  }
}