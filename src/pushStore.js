import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("./data");
const REG_PATH = path.join(DATA_DIR, "registrations.json");
const MAP_PATH = path.join(DATA_DIR, "passes.json");

function ensure(){ if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true}); }
function readJSON(p){ try{ return JSON.parse(fs.readFileSync(p,"utf8")); } catch{ return {}; } }
function writeJSON(p,o){ fs.writeFileSync(p, JSON.stringify(o,null,2)); }

export function saveSerialMapping(serial, payload){ ensure(); const m=readJSON(MAP_PATH); m[serial]=payload; writeJSON(MAP_PATH,m); }
export function getMappingBySerial(serial){ const m=readJSON(MAP_PATH); return m[serial]||null; }

export function saveDeviceRegistration({deviceLibraryIdentifier, passTypeIdentifier, serialNumber, pushToken}){
  ensure(); const r=readJSON(REG_PATH);
  const cur=r[deviceLibraryIdentifier]||{passTypeIdentifier, pushToken, serialNumbers:[]};
  cur.passTypeIdentifier=passTypeIdentifier; if(pushToken) cur.pushToken=pushToken;
  if(!cur.serialNumbers.includes(serialNumber)) cur.serialNumbers.push(serialNumber);
  r[deviceLibraryIdentifier]=cur; writeJSON(REG_PATH,r);
}
export function listSerialsForDevice(deviceLibraryIdentifier, passTypeIdentifier){
  const r=readJSON(REG_PATH)[deviceLibraryIdentifier]; if(!r||r.passTypeIdentifier!==passTypeIdentifier) return []; return r.serialNumbers||[];
}
export function allRegistrationsForSerials(serials){
  const regs=readJSON(REG_PATH), out=[];
  for(const [dev,r] of Object.entries(regs)){ for(const s of (r.serialNumbers||[])){
    if(!serials.length || serials.includes(s)) out.push({deviceLibraryIdentifier:dev, pushToken:r.pushToken, serialNumber:s, passTypeIdentifier:r.passTypeIdentifier});
  }}
  return out;
}
