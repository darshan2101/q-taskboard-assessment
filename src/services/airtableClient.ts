import Airtable from "airtable";

const client = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY });

export const base = client.base(process.env.AIRTABLE_BASE_ID!);
