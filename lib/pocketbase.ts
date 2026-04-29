import PocketBase from "pocketbase";

const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL);

// Keep auth token refreshed automatically
pb.autoCancellation(false);

export default pb;
