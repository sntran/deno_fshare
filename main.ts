#!/usr/bin/env -S deno run --allow-net --allow-env

import { basename, join, parseFlags } from "./deps.ts";

import { Client } from "./client.ts";

const flags = parseFlags(Deno.args, {
  boolean: [
    /** Whether to follows redirect */
    "location",
    /** Whether to use remote name as output. */
    "remote-name",
  ],
  string: [
    "_",
    "username",
    "password",
    /** Any custom header */
    "header",
    /** Input body */
    "body",
    /** Output filename */
    "output",
  ],
  collect: [
    "header",
  ],
  alias: {
    "username": ["user", "u"],
    "password": ["pass", "p"],
    "header": "H",
    "body": "B",
    "location": "L",
    "output": "o",
    "remote-name": ["O", "remoteName"],
  },
  default: {
    user: Deno.env.get("FSHARE_USER_EMAIL"),
    pass: Deno.env.get("FSHARE_PASSWORD"),
  },
});

const {
  username,
  password,
  header,
  location,
  remoteName,
  _: [command, ...args],
} = flags;

let {
  output,
} = flags;

const headers = [].concat(header).reduce((headers, header: string) => {
  const [key, value] = header.split(/:\s?/);
  headers.append(key, value);
  return headers;
}, new Headers());

if (username && password) {
  headers.set("Authorization", `Basic ${btoa(`${username}:${password}`)}`);
}

const client = new Client({
  headers,
});
// Login
const response = await client.login();
if (!response.ok) {
  console.error("Login failed");
  Deno.exit(1);
}

let writable: WritableStream = Deno.stdout.writable;

if (output) {
  writable = (await Deno.open(output, {
    read: false,
    create: true,
    write: true,
  })).writable;
}

const redirect = location ? "follow" : "manual";

if (command === "download") {
  const { url, body } = await client.download(args[0], {
    redirect,
  });

  if (remoteName) {
    output = new URL(url).pathname.split("/").pop();
    writable = (await Deno.open(output, {
      read: false,
      create: true,
      write: true,
    })).writable;
  }

  if (body) {
    body.pipeTo(writable);
  }
}

if (command === "upload") {
  const input = args[0], path = args[1] || "/";
  if (!input) {
    console.error("Missing input file");
    Deno.exit(1);
  }

  const file = await Deno.open(input, {
    read: true,
    write: false,
  });

  const response = await client.upload(join(path, basename(input)), {
    redirect,
    headers: {
      "Content-Length": (await file.stat()).size,
    },
    body: file.readable,
  });

  if (!response.ok) {
    console.error("Upload failed");
    Deno.exit(1);
  }

  const { url } = await response.json();
  console.log(url);
}