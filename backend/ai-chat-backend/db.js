const { MongoClient } = require("mongodb");

// MongoDB connection shared by the whole backend.
// Configure with MONGODB_URI (and optionally MONGODB_DB) in .env.

const DEFAULT_URI = "mongodb://127.0.0.1:27017";
const DEFAULT_DB = "slack_ai_workspace";

let client = null;
let db = null;

// Documents use our own string `id` fields; Mongo's _id is never sent to clients
const NO_MONGO_ID = { projection: { _id: 0 } };

async function connectDb({
  uri = process.env.MONGODB_URI || DEFAULT_URI,
  dbName = process.env.MONGODB_DB || DEFAULT_DB
} = {}) {
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  db = client.db(dbName);
  await ensureIndexes();
  return db;
}

function getDb() {
  if (!db) throw new Error("Database is not connected yet.");
  return db;
}

const collections = {
  members: () => getDb().collection("members"),
  messages: () => getDb().collection("messages"),
  channels: () => getDb().collection("channels"),
  directMessages: () => getDb().collection("directMessages"),
  directReads: () => getDb().collection("directReads"),
  settings: () => getDb().collection("settings"),
  loginTokens: () => getDb().collection("loginTokens"),
  loginApprovals: () => getDb().collection("loginApprovals"),
  sessions: () => getDb().collection("sessions")
};

async function ensureIndexes() {
  await Promise.all([
    collections.members().createIndex({ id: 1 }, { unique: true }),
    collections.members().createIndex({ email: 1 }, { unique: true }),
    collections.members().createIndex({ inviteToken: 1 }, { sparse: true }),
    collections.messages().createIndex({ id: 1 }, { unique: true }),
    collections.messages().createIndex({ createdAt: 1 }),
    collections.messages().createIndex({ channel: 1, createdAt: 1 }),
    collections.messages().createIndex({ parentId: 1, createdAt: 1 }, { sparse: true }),
    collections.channels().createIndex({ id: 1 }, { unique: true }),
    collections.channels().createIndex({ name: 1 }, { unique: true }),
    collections.directMessages().createIndex({ id: 1 }, { unique: true }),
    collections.directMessages().createIndex({ conversation: 1, createdAt: 1 }),
    collections.directMessages().createIndex({ parentId: 1, createdAt: 1 }, { sparse: true }),
    collections.sessions().createIndex({ memberId: 1 }),
    // Unused sign-in links are deleted by MongoDB once they expire
    collections.loginTokens().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.loginApprovals().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  ]);
}

async function closeDb() {
  await client?.close();
  client = null;
  db = null;
}

module.exports = { connectDb, closeDb, getDb, collections, NO_MONGO_ID };
