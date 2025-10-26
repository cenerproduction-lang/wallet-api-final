import fs from "fs";
import http2 from "http2";
import tls from "tls";
import path from "path";

const APNS_HOST = "api.push.apple.com";
const APNS_PORT = 443;

function creds(){
  const cert = fs.readFileSync(path.resolve(process.env.APNS_CERT_PATH));
  const key  = fs.readFileSync(path.resolve(process.env.APNS_KEY_PATH));
  return { cert, key };
}

export async function sendPasskitPush({ pushToken, topic }){
  const { cert, key } = creds();
  const client = http2.connect(`https://${APNS_HOST}:${APNS_PORT}`, {
    createConnection: () => tls.connect({ host: APNS_HOST, port: APNS_PORT, cert, key, rejectUnauthorized: true })
  });
  return new Promise((resolve, reject) => {
    client.on("error", reject);
    const req = client.request({
      ":method":"POST", ":scheme":"https", ":path":`/3/device/${pushToken}`,
      "apns-topic": topic, "apns-push-type":"pass"
    });
    req.on("response", h => { let d=""; req.on("data",c=>d+=c); req.on("end",()=>{ client.close(); resolve({ok:true, headers:h, body:d}); }); });
    req.end();
  });
}
