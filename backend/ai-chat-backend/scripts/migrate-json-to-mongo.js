// One-time import of the old JSON data files into MongoDB.
// Usage: npm run migrate
//
// Safe to run more than once: every record is upserted by its id, so nothing
// is duplicated. The JSON files are left untouched as a backup.
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { connectDb, closeDb, collections } = require("../db");

const DATA_DIR = path.join(__dirname, "..", "data");

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
  } catch {
    return fallback;
  }
}

async function upsertAll(collection, docs, keyOf) {
  if (!docs.length) return 0;
  const result = await collection.bulkWrite(
    docs.map((doc) => {
      // _id comes from the filter on insert and can't be $set on update
      const { _id, ...fields } = doc;
      return { updateOne: { filter: keyOf(doc), update: { $set: fields }, upsert: true } };
    })
  );
  return result.upsertedCount + result.modifiedCount;
}

async function main() {
  const general = readJson("general.json", { members: [], messages: [] });
  const direct = readJson("direct.json", { messages: [], lastRead: {} });
  const auth = readJson("auth.json", { sessions: {} });

  await connectDb();
  console.log("Connected. Importing from", DATA_DIR);

  // Members, with roles filled in for data saved before roles existed
  const members = general.members.map((m) => ({ role: "member", ...m }));
  if (!members.some((m) => m.status === "joined" && m.role === "owner")) {
    const creator = members
      .filter((m) => m.status === "joined")
      .sort((a, b) => (a.joinedAt || "").localeCompare(b.joinedAt || ""))[0];
    if (creator) creator.role = "owner";
  }
  const counts = {
    members: await upsertAll(collections.members(), members, (m) => ({ id: m.id })),
    messages: await upsertAll(collections.messages(), general.messages, (m) => ({ id: m.id })),
    directMessages: await upsertAll(collections.directMessages(), direct.messages, (m) => ({
      id: m.id
    }))
  };

  const reads = Object.entries(direct.lastRead || {}).flatMap(([conversation, byMember]) =>
    Object.entries(byMember).map(([memberId, lastRead]) => ({
      _id: `${conversation}:${memberId}`,
      conversation,
      memberId,
      lastRead
    }))
  );
  counts.directReads = await upsertAll(collections.directReads(), reads, (r) => ({ _id: r._id }));

  if (general.settings) {
    await collections
      .settings()
      .updateOne({ _id: "workspace" }, { $set: general.settings }, { upsert: true });
    counts.settings = 1;
  }

  // Sessions keep their hashes, so everyone stays signed in after the switch
  const sessions = Object.entries(auth.sessions || {}).map(([tokenHash, s]) => ({
    _id: tokenHash,
    memberId: s.memberId,
    createdAt: new Date(s.createdAt || Date.now())
  }));
  counts.sessions = await upsertAll(collections.sessions(), sessions, (s) => ({ _id: s._id }));

  console.log("Imported (new or updated):", counts);
  await closeDb();
}

main().catch(async (error) => {
  console.error("Migration failed:", error.message || error);
  await closeDb();
  process.exit(1);
});
