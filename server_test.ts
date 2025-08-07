import { assertEquals } from "@std/assert";
import { add } from "./main.ts";

import { generateSecretKey, getPublicKey, verifyEvent } from "@nostr/tools";
import { NRelay1, NSecSigner } from "@nostrify/nostrify";
import { faker } from "https://esm.sh/@faker-js/faker";

import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";
const env = await load();

Deno.test(function addTest() {
  assertEquals(add(2, 3), 5);
});

Deno.test("Check if we can connect to nostr relay", async () => {
  const relay = new NRelay1(env.RELAY_URLS.split(",")[0]);
  let relay_works = false;
  async function checkResponse() {
    for await (const msg of relay.req([{}])) {
      if (msg[0] === "EVENT") {
        relay_works = true;
      }
      if (msg[0] === "EOSE") break; // Sends a `CLOSE` message to the relay.
    }
  }
  checkResponse();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await relay.close();
  if (!relay_works) {
    throw new Error(
      "Unable to connect to relay",
    );
  }
});
Deno.test("Claim a NIP05 and check Bot response", async () => {
  const sk: Uint8Array = generateSecretKey(); // `sk` is a Uint8Array
  const pk: string = getPublicKey(sk); // `pk` is a hex string
  const signer = new NSecSigner(sk);
  const unix_time: number = Math.floor((new Date()).getTime() / 1000);
  const username: string = faker.internet.username();
  const event = await signer.signEvent({
    kind: 3036,
    content: "Hello, world!",
    tags: [
      ["L", "nip05.domain"],
      ["l", env.DOMAIN_NAME.toLowerCase(), "nip05.domain"],
      ["p", pk],
      ["d", username.toLowerCase()],
    ],
    created_at: unix_time,
  });
  assertEquals(verifyEvent(event), true);
  const relay = new NRelay1(env.RELAY_URLS.split(",")[0]);
  await relay.event(event);
  const response_filter = {
    kinds: [30360],
    "#L": ["nip05.domain"],
    "#l": [env.DOMAIN_NAME.toLowerCase()],
    "#p": [pk],
    "#d": [username.toLowerCase()],
  };
  let we_found_nip05 = false;
  await new Promise((resolve) => setTimeout(resolve, 2000));
  async function checkResponse() {
    for await (const msg of relay.req([response_filter])) {
      if (msg[0] === "EVENT") {
        we_found_nip05 = true;
        break;
      }
      if (msg[0] === "EOSE") break; // Sends a `CLOSE` message to the relay.
    }
  }
  checkResponse();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await relay.close();
  if (!we_found_nip05) {
    throw new Error(
      "publishBasicEvent: Could not verify the response from the bot",
    );
  }
});

Deno.test("Claim a NIP05, check Bot response, try and claim same username with separate account", async () => {
  const sk: Uint8Array = generateSecretKey(); // `sk` is a Uint8Array
  const pk: string = getPublicKey(sk); // `pk` is a hex string
  const signer = new NSecSigner(sk);
  const unix_time: number = Math.floor((new Date()).getTime() / 1000);
  const username: string = faker.internet.username();
  const event = await signer.signEvent({
    kind: 3036,
    content: "Hello, world!",
    tags: [
      ["L", "nip05.domain"],
      ["l", env.DOMAIN_NAME.toLowerCase(), "nip05.domain"],
      ["p", pk],
      ["d", username.toLowerCase()],
    ],
    created_at: unix_time,
  });
  assertEquals(verifyEvent(event), true);
  const relay = new NRelay1(env.RELAY_URLS.split(",")[0]);
  await relay.event(event);
  const response_filter = {
    kinds: [30360],
    "#L": ["nip05.domain"],
    "#l": [env.DOMAIN_NAME.toLowerCase()],
    "#p": [pk],
    "#d": [username.toLowerCase()],
  };
  let we_found_nip05 = false;
  await new Promise((resolve) => setTimeout(resolve, 2000));
  async function checkResponse() {
    for await (const msg of relay.req([response_filter])) {
      if (msg[0] === "EVENT") {
        we_found_nip05 = true;
        break;
      }
      if (msg[0] === "EOSE") break; // Sends a `CLOSE` message to the relay.
    }
  }
  checkResponse();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (!we_found_nip05) {
    throw new Error(
      "publishBasicEvent: Could not verify the response from the bot",
    );
  }

  const sk2: Uint8Array = generateSecretKey(); // `sk` is a Uint8Array
  const pk2: string = getPublicKey(sk2); // `pk` is a hex string
  const signer2 = new NSecSigner(sk2);
  const unix_time2: number = Math.floor((new Date()).getTime() / 1000);
  const event2 = await signer2.signEvent({
    kind: 3036,
    content: "Hello, world!",
    tags: [
      ["L", "nip05.domain"],
      ["l", env.DOMAIN_NAME.toLowerCase(), "nip05.domain"],
      ["p", pk2],
      ["d", username.toLowerCase()],
    ],
    created_at: unix_time2,
  });
  await relay.event(event2);
  const response_filter2 = {
    kinds: [30360],
    "#L": ["nip05.domain"],
    "#l": [env.DOMAIN_NAME.toLowerCase()],
    "#d": [username.toLowerCase()],
  };
  let responseCount = 0;
  await new Promise((resolve) => setTimeout(resolve, 2000));
  async function checkResponse2() {
    for await (const msg of relay.req([response_filter2])) {
      if (msg[0] === "EVENT") {
        responseCount += 1;
        break;
      }
      if (msg[0] === "EOSE") break; // Sends a `CLOSE` message to the relay.
    }
  }
  checkResponse2();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await relay.close();
  if (responseCount != 1) {
    throw new Error(
      `responseCount=${responseCount} when it should equal 1`,
    );
  }
});
