import express from "express";
import path from "path";

/**
 * Production static file server for the POS app.
 * For development, use `npx vite` directly instead.
 */
const app = express();
const PORT = process.env.PORT || 3000;

const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`POS server running on http://localhost:${PORT}`);
});
