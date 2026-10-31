// npm run db:sync — bring a database created by an older version up to date: add new properties, update the
// location pick lists, tidy stored locations and score called companies for follow-up. Safe to run more than once.
import { PrismaClient } from "@prisma/client";
import { addMissingProperties, syncGeoProperties, syncGeoRecords } from "../src/lib/crm/metadata-sync";
import { rescoreUnscored } from "../src/lib/crm/follow-score";

const db = new PrismaClient();

async function main() {
  const added = await addMissingProperties(db);
  console.log(added.length ? `Properties added: ${added.join(", ")}.` : "No new properties.");
  const zones = await syncGeoProperties(db);
  console.log(`Location properties updated (${zones} time zones).`);
  const { changed, unknownCountries } = await syncGeoRecords(db);
  console.log(`Records updated: ${changed}.`);
  if (unknownCountries.length) console.log(`Countries not in the list (left as they are): ${unknownCountries.join(", ")}`);
  // Follow-up scores for companies called before scoring existed (or imported with call history)
  const scored = await rescoreUnscored();
  console.log(scored ? `Follow-up scores calculated for ${scored} companies.` : "Follow-up scores up to date.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
