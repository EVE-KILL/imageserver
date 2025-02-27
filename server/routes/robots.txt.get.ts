export default defineEventHandler(async (event) => {
    setHeader(event, 'Content-Type', 'text/plain');
    return `User-agent: *
Disallow: /`;
});
