import { createApp } from './app.ts';
import { config } from './config.ts';

const app = createApp();

app.listen(config.port, config.host, () => {
  console.log(`Keepers AI service listening on http://${config.host}:${config.port}`);
  console.log(`Default provider: ${config.defaultProvider}`);
});
