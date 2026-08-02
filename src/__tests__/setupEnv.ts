// Loaded via jest setupFiles: provide Redash credentials before any test
// module imports code that reads them.
process.env.REDASH_URL = "https://redash.example.com";
process.env.REDASH_API_KEY = "test-api-key";
