import * as DataPeps from "../src/DataPeps";
import * as Config from "./Config";
import * as nacl from "tweetnacl";

export interface initCtx {
  seed: number;
}

export function init(): initCtx {
  let seed = Math.floor(Math.random() * 99999);
  return { seed };
}

export interface adminCtx {
  admin: DataPeps.Identity<void>;
  adminSecret: Uint8Array;
  adminSession: DataPeps.Session;
}

export async function admin(): Promise<adminCtx> {
  let admin = Config.admin;
  let adminSecret = new TextEncoder().encode(Config.adminSecret);
  try {
    await DataPeps.register(admin, adminSecret);
  } catch (e) {
    if (
      !(
        e instanceof DataPeps.Error &&
        e.kind == DataPeps.ServerError.IdentityAlreadyExists
      )
    ) {
      throw e;
    }
  }
  let adminSession = await DataPeps.login(admin.login, adminSecret);
  return { admin, adminSecret, adminSession };
}

export interface userPayload {
  description: string;
  firstname: string;
  lastname: string;
}

export interface userCtx {
  identity: DataPeps.Identity<Uint8Array>;
  secret: Uint8Array;
}

export async function user(init: initCtx, name: string): Promise<userCtx> {
  let secret = nacl.randomBytes(128);
  let identity: DataPeps.IdentityFields = {
    login: `${name}.${init.seed}`,
    name: `${name} martin`,
    kind: "pepsswarm/0",
    payload: new TextEncoder().encode(
      JSON.stringify({
        firstname: name,
        lastname: "typescript",
        description: `${name} is a test identity from typescript integration test`
      } as userPayload)
    )
  };
  await DataPeps.register(identity, secret);
  return {
    identity: { ...identity, created: new Date(), admin: false, active: true },
    secret
  };
}

export interface userAndSessionCtx extends userCtx {
  session: DataPeps.Session;
}

export async function userAndSession(
  init: initCtx,
  name: string
): Promise<userAndSessionCtx> {
  let ctx = await user(init, name);
  let session = await DataPeps.login(ctx.identity.login, ctx.secret);
  return { ...ctx, session };
}

export interface aliceBobCtx {
  alice: userAndSessionCtx;
  bob: userAndSessionCtx;
}

export async function aliceBob(init: initCtx): Promise<aliceBobCtx> {
  let alice = await userAndSession(init, "alice");
  let bob = await userAndSession(init, "bob");
  return { alice, bob };
}

export interface aliceBobWithDeviceAndGroupCtx extends aliceBobCtx {
  aliceDevice: userAndSessionCtx;
  bobDevice: userAndSessionCtx;
  group: DataPeps.Identity<Uint8Array>;
}

export interface groupPayload {
  description: string;
}

async function createDevice(
  user: userAndSessionCtx
): Promise<userAndSessionCtx> {
  let device = {
    login: `device.${user.identity.login}`,
    name: `Phone of ${user.identity.name}`,
    kind: "test/device",
    payload: null
  };
  let secret = nacl.randomBytes(1024);
  await user.session.Identity.create(device, { secret });
  let session = await DataPeps.login(device.login, secret);
  await user.session.Identity.extendSharingGroup(user.identity.login, [
    device.login
  ]);
  return {
    secret,
    identity: { ...device, created: new Date(), admin: false, active: true },
    session
  };
}

export async function aliceBobWithDeviceAndGroup(
  init: initCtx
): Promise<aliceBobWithDeviceAndGroupCtx> {
  let abCtx = await aliceBob(init);
  let groupFields = {
    login: `aliceBob.${init.seed}`,
    name: `Alice&Bob's`,
    kind: "test/group",
    payload: new TextEncoder().encode(
      JSON.stringify({
        description: `A group shared by alice & bob`
      } as groupPayload)
    )
  };
  await abCtx.alice.session.Identity.create(groupFields, {
    sharingGroup: [abCtx.alice.identity.login, abCtx.bob.identity.login]
  });
  let aliceDevice = await createDevice(abCtx.alice);
  let bobDevice = await createDevice(abCtx.bob);
  return {
    ...abCtx,
    aliceDevice,
    bobDevice,
    group: { ...groupFields, created: new Date(), admin: false, active: true }
  };
}

export interface devCtx {
  dev: userAndSessionCtx;
  app: DataPeps.Identity<Uint8Array>;
}

export async function dev(init: initCtx): Promise<devCtx> {
  let dev = await userAndSession(init, "dev");
  let app: DataPeps.IdentityFields = {
    login: `app.${init.seed}`,
    name: "A killer app",
    kind: "pepsswarm/3",
    payload: new TextEncoder().encode(
      JSON.stringify({
        description: `app allows you to do awesome stuff and respect your privacy`
      })
    )
  };
  await dev.session.Identity.create(app, {
    sharingGroup: [dev.identity.login]
  });
  return {
    dev,
    app: { ...app, created: new Date(), admin: false, active: true }
  };
}