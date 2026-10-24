import {createSignalingServer} from './index.mjs';
const app=createSignalingServer({env:process.env});
app.server.listen(Number(process.env.PORT),'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void app.close().then(()=>process.exit(0)));
