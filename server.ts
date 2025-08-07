import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";
const env = await load();

import { NPool, NRelay1, NSecSigner } from "@nostrify/nostrify";
import { getPublicKey, nip19, verifyEvent } from "@nostr/tools";
import { NSchema as n } from "@nostrify/nostrify";

export const my_pool = new NPool({
  open: (url) => new NRelay1(url),
  reqRouter: async (filters) => new Map([]),
  eventRouter: async (
    event,
  ) => [],
});

let npub = nip19.npubEncode(getPublicKey(nip19.decode(env.NSEC).data));
console.log(`Server npub   = ${npub}`);
console.log(`Server pubkey = ${getPublicKey(nip19.decode(env.NSEC).data)}`)
console.log(`relays_urls   = ${JSON.stringify(env.RELAY_URLS.split(","))}`);

const signer = new NSecSigner(nip19.decode(env.NSEC).data);

async function publishProfileAndNIP65(signer) {
  const unix_time: number = Math.floor((new Date()).getTime() / 1000);
  let profile_json = JSON.parse(env.PROFILE_JSON)
  profile_json.nip05 = `${env.USERNAME}@${env.DOMAIN_NAME}`
  let profile_event_data = {
    created_at: unix_time,
    content: JSON.stringify(profile_json),
    kind: 0,
    tags: [],
  }
  const profile_event = await signer.signEvent(profile_event_data)
  let relay_url_list = ["r"]
  for (const relay_url of env.RELAY_URLS.split(",")) {
    relay_url_list.push(relay_url)
  } 
  const nip65_data = {
    created_at: unix_time,
    content: "",
    kind: 0,
    tags: [
      relay_url_list
    ],
  }
  const nip65_event = await signer.signEvent(nip65_data)
  await my_pool.event(profile_event, { relays: env.PROFILE_PUBLISH_RELAYS.split(",") })
  await my_pool.event(nip65_event, { relays: env.PROFILE_PUBLISH_RELAYS.split(",") })
  console.log(`Sucessfully published profile and nip-65 events\nnip65_event_id=${nip65_event.id}\nprofile_event_id=${profile_event.id}`)
  const personal_nip05 = {
    created_at: unix_time,
    content: "",
    kind: 3036,
    tags: [
      relay_url_list,
      ["L", "nip05.domain"],
      ["l", env.DOMAIN_NAME.toLocaleLowerCase(), "nip05.domain"],
      ["p", await signer.getPublicKey()],
      ["d", env.USERNAME.toLocaleLowerCase()],
    ],
  }
  const personal_nip05_event = await signer.signEvent(personal_nip05)
  console.log(personal_nip05_event)
  produceKind30360(personal_nip05_event);
}

async function main() {
  publishProfileAndNIP65(signer)
  const unix_time: number = Math.floor((new Date()).getTime() / 1000);
  const filter: object = {
    kinds: [3036],
    since: unix_time - 10,
    "#L": ["nip05.domain"],
    "#l": [env.DOMAIN_NAME, "nip05.domain"],
  };
  console.log("\nFilter:");
  console.log(filter);
  for await (
    const msg of my_pool.req([filter], { relays: env.RELAY_URLS.split(",") })
  ) {
    if (msg[0] === "EVENT") {
      const event = n.event().refine(verifyEvent).parse(msg[2]);
      if (verifyKind3036(event)) {
        produceKind30360(event);
      }
    }
    // if (msg[0] === "EOSE") break; // Sends a `CLOSE` message to the relay.
  }
}

main();

import { Hono } from "@hono/hono";

const app = new Hono();
const port = env.PORT ? parseInt(env.PORT) : 8080;

async function resolveNostrDotJson(c: any){
    const id = c.req.param("id");
  console.log("ID");
  let query = c.req.queries();
  if (!("name" in query)) {
    c.json({ names: {}, relays: {} });
    return true;
  }
  const response_filter = {
    limit: 1,
    kinds: [30360],
    "#L": ["nip05.domain"],
    "#l": [env.DOMAIN_NAME.toLowerCase()],
    "#d": [query.name[0].toLowerCase()],
  };
  console.log(response_filter);
  let result = {};
  async function checkResponse() {
    for await (
      const msg of my_pool.req([response_filter], {
        relays: env.RELAY_URLS.split(","),
      })
    ) {
      if (msg[0] === "EVENT") {
        result = msg[2];
        break;
      }
      if (msg[0] === "EOSE") break; // Sends a `CLOSE` message to the relay.
    }
  }
  checkResponse();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (Object.keys(result).length == 0) {
    return c.json({
      names: {},
      relays: {},
    });
  }
  let pubkey = getFirstItemsWithMatch(result.tags, "p")
  if(pubkey != undefined){
    if(pubkey.length >= 2) {
        pubkey = pubkey[1]
    }
  }
  let relays = getFirstItemsWithMatch(result.tags, "r")
  if(relays != undefined) {
      relays.shift()
  }
  return c.json({
    names: {
      [query.name[0].toLowerCase()] : pubkey
    },
    relays: {
      [pubkey] : relays
    },
  });
}
app.get("/", (c) => {
  return c.text("Hello Hono!");
});


app.get("/nostr.json", async (c) => {
  return resolveNostrDotJson(c)
});

app.get(".well-known/nostr.json", async (c) => {
  return resolveNostrDotJson(c)
});

Deno.serve({ port }, app.fetch);

function countOccurrences(list: [string], str: string) {
  const count = list.reduce((acc, item) => acc + (item === str ? 1 : 0), 0);
  return count > 1;
}
function getFirstItemsWithMatch(listOfLists: [string], searchStr: string) {
  for (const item of listOfLists) {
    if (item[0] == searchStr) {
      return item;
    }
  }
}
async function verifyKind3036(event) {
  // Check for Duplicate and Required Tags
  const firstItems = event.tags.map((sublist) => sublist[0]);
  const requiredTags = ["L", "p", "d", "l"];
  for (const eventTag of requiredTags) {
    if (!firstItems.includes(eventTag)) {
      console.error(`event_id=${event.id} is missing tag=${eventTag}`);
      return false;
    }
  }
  if (countOccurrences(firstItems, "L")) {
    console.error(`event_id=${event.id} has duplicate "L" tags`);
    return false;
  }
  if (countOccurrences(firstItems, "l")) {
    console.error(`event_id=${event.id} has duplicate "l" tags`);
    return false;
  }
  if (countOccurrences(firstItems, "d")) {
    console.error(`event_id=${event.id} has duplicate "d" tags`);
    return false;
  }
  // We only accept one p tag because they get assigned the nip05 identifier
  if (countOccurrences(firstItems, "p")) {
    console.error(`event_id=${event.id} has duplicate "p" tags`);
    return false;
  }

  // Check for required length of tags
  // We don't need to check tag L because it is in the filter
  // We don't need to check the l tag because it is in the filter
  if (getFirstItemsWithMatch(event.tags, "p").length < 1) {
    console.error(`event_id=${event.id} tag p requires length of two`);
    return false;
  }
  if (getFirstItemsWithMatch(event.tags, "d").length < 1) {
    console.error(`event_id=${event.id} tag d requires length of two`);
    return false;
  }

  // Check the domain name maches
  if (getFirstItemsWithMatch(event.tags, "l")[1] != env.DOMAIN_NAME) {
    console.error(
      `event_id=${event.id} "l" tag has invalid domain name=${
        getFirstItemsWithMatch(event.tags, "l")[1]
      }, domain name should be ${env.DOMAIN_NAME}`,
    );
    return false;
  }

  // Check if the p tag is a nostr public key
  if (getFirstItemsWithMatch(event.tags, "p")[1].length != 64) {
    console.error(
      `event_id=${event.id} "p" tag has pubkey, length should be 64`,
    );
    return false;
  }

  // Check the d tag, username,  is lowercase
  const username = getFirstItemsWithMatch(event.tags, "d")[1];
  if (!/^[a-z0-9_.-]*$/.test(username)) {
    console.error(
      `event_id=${event.id} Invalid username=${username} it must be be lowercase with numbers`,
    );
    return false;
  }

  // Check if username is already claimed
  const username_filter = {
    kinds: [30360],
    "#L": ["nip05.domain"],
    "#l": [env.DOMAIN_NAME, "nip05.domain"],
    "#d": [username],
  };
  console.log("username_filter");
  console.log(username_filter);
  let found_username = false;
  for await (
    const msg of my_pool.req([username_filter], {
      relays: env.RELAY_URLS.split(","),
    })
  ) {
    console.log("MSG");
    console.log(msg);
    if (msg[0] === "EVENT") {
      console.log("WE_SHOULD_HAVE_ERROR");
      console.log(msg[2]);
      console.error(
        `event_id=${event.id} Found Username claimed via ${msg[2].id}`,
      );
      found_username = true;
      return false;
    }
    if (msg[0] === "EOSE") break; // Sends a `CLOSE` message to the relay.
  }
  if (found_username) {
    return true;
  }

  // Check if pubkey is already being used
  const pubkey_filter = {
    kinds: [30360],
    "#L": ["nip05.domain"],
    "#l": [env.DOMAIN_NAME, "nip05.domain"],
    "#d": [username],
    "#p": [event.pubkey],
  };
  let found_pubkey = false;
  for await (
    const msg of my_pool.req([pubkey_filter], {
      relays: env.RELAY_URLS.split(","),
    })
  ) {
    if (msg[0] === "EVENT") {
      console.error(
        `event_id=${event.id} Found pubkey already claimed nip05 via ${
          msg[2].id
        }`,
      );
      console.log(event);
      console.log(msg[2]);
      found_pubkey = true;
    }
    if (msg[0] === "EOSE") break; // Sends a `CLOSE` message to the relay.
  }
  if (!found_pubkey) {
    return false;
  }

  // Return true because all checks passed
  console.log(`event_id=${event.id} passed the verifyKind3036 check`);
  return true;
}

async function produceKind30360(event) {
  const unix_time: number = Math.floor((new Date()).getTime() / 1000);
  let event_data = {
    created_at: unix_time,
    content: "",
    kind: 30360,
    tags: [
      ["L", "nip05.domain"],
      ["p", getFirstItemsWithMatch(event.tags, "p")[1]], // pubkey
      ["l", getFirstItemsWithMatch(event.tags, "l")[1]], // domain_name
      ["d", getFirstItemsWithMatch(event.tags, "d")[1]], // username
      ["e", event.id],
    ],
  };
  if (getFirstItemsWithMatch(event.tags, "r") != undefined) {
    event_data.tags.push(getFirstItemsWithMatch(event.tags, "r"));
  }
  const auth_event = await signer.signEvent(event_data);
  console.log("auth_event");
  console.log(auth_event);
  my_pool.event(auth_event, { relays: env.RELAY_URLS.split(",") });
}
