const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function deleteWithRetry(id: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await base44.entities.Target.delete(id);
      return;
    } catch (e: any) {
      if (e?.status === 429) {
        const wait = 3000 * (attempt + 1);
        console.log(`Rate limited, waiting ${wait}ms...`);
        await sleep(wait);
      } else {
        throw e;
      }
    }
  }
}

let deleted = 0;

while (true) {
  const records = await base44.entities.Target.filter({}, null, 100, 0);
  if (!records || records.length === 0) break;

  console.log(`Found ${records.length}, deleting...`);
  for (const r of records) {
    await deleteWithRetry(r.id);
    deleted++;
    await sleep(150);
  }
  console.log(`Total deleted: ${deleted}`);
  await sleep(2000);
}

console.log(`Done. Total deleted: ${deleted}`);
