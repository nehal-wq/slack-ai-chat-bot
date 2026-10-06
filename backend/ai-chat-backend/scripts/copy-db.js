// Copies every collection from one MongoDB database to another, e.g. from
// your local MongoDB to MongoDB Atlas before going live.
//
// Usage (PowerShell):
//   $env:COPY_FROM_URI="mongodb://127.0.0.1:27017/slack_ai_workspace"
//   $env:COPY_TO_URI="mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/slack_ai_workspace"
//   npm run copy-db
//
// Documents are upserted by _id, so running it twice doesn't duplicate
// anything. Indexes are created by the server when it starts.
const { MongoClient } = require("mongodb");

async function main() {
  const fromUri = process.env.COPY_FROM_URI;
  const toUri = process.env.COPY_TO_URI;
  if (!fromUri || !toUri) {
    console.error("Set COPY_FROM_URI and COPY_TO_URI (each including the database name).");
    process.exit(1);
  }

  const from = await MongoClient.connect(fromUri);
  const to = await MongoClient.connect(toUri);
  const source = from.db();
  const target = to.db();
  console.log(`Copying ${source.databaseName} → ${target.databaseName}`);

  try {
    for (const { name } of await source.listCollections({}, { nameOnly: true }).toArray()) {
      const docs = await source.collection(name).find({}).toArray();
      if (docs.length) {
        await target.collection(name).bulkWrite(
          docs.map((doc) => ({
            replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true }
          }))
        );
      }
      console.log(`  ${name}: ${docs.length}`);
    }
    console.log("Done.");
  } finally {
    await from.close();
    await to.close();
  }
}

main().catch((error) => {
  console.error("Copy failed:", error.message || error);
  process.exit(1);
});
