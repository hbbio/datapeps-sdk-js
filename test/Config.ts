import * as DataPeps from "../src/DataPeps";

declare var process: any;
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

let APIHost = process.env.PEPSCRYPTO_HOST;
if (APIHost == null) {
  throw new Error("Missing PEPSCRYPTO_HOST");
}
APIHost = "https://" + APIHost;

let sdk = DataPeps;
sdk.configure(APIHost);

export { sdk };

export let admin: DataPeps.Identity<any> = {
  login: "administrator",
  name: "Administrator created for Test from TS",
  admin: true,
  active: true,
  kind: "pepsswarm/0",
  created: new Date(),
  payload: {
    firstname: "Quentin",
    lastname: "Bourgerie"
  }
};

export let adminSecret = "Azertyuiop33";

export function init(): Promise<void> {
  return sdk.register(admin, adminSecret).catch(function(err) {
    if (err instanceof DataPeps.Error) {
      if (err.kind == DataPeps.ServerError.IdentityAlreadyExists) {
        return;
      }
    }
    throw err;
  });
}

export function adminLogin(): Promise<DataPeps.Session> {
  return DataPeps.Session.login(admin.login, adminSecret);
}

declare var require: any;
declare var global: any;

if (global["btoa"] === undefined) {
  global["btoa"] = require("btoa");
}
if (global["atob"] === undefined) {
  global["atob"] = require("atob");
}
if (global["TextEncoder"] === undefined) {
  global["TextEncoder"] = require("text-encoding").TextEncoder;
}
if (global["TextDecoder"] === undefined) {
  global["TextDecoder"] = require("text-encoding").TextDecoder;
}
if (global["XMLHttpRequest"] === undefined) {
  global["XMLHttpRequest"] = require("xhr2");
}
if (global["WebSocket"] === undefined) {
  global["WebSocket"] = require("ws");
}
