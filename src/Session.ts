import * as nacl from "tweetnacl";
import { api } from "./proto";
import {
  IdentityPublicKey,
  IdentityPublicKeyID,
  IdentityAPI
} from "./IdentityAPI";
import { Error, SDKKind, ServerKind } from "./Error";
import { Uint8Tool, Base64 } from "./Tools";
import { Client, Request, client } from "./HTTP";
import { SignedCipher } from "./Cryptor";

import {
  MemoryPublicKeyCache,
  TrustOnFirstUse,
  TrustPolicy,
  PublicKeysCache
} from "./SessionUtils";
import {
  IdentityKeySet,
  MasterPrivateSeed,
  IdentityEncryptedKeySet
} from "./IdentityKeySet";
import { IdentityKeySetAPI } from "./IdentityKeySetAPI";
import { CipherType } from "./Cryptor";

/**
 * Specify how the sdk request should be authenticated by the DataPeps service.
 * - "RAND" means that the service generates a fresh salt for each request `n` which is used to sign request `n+1`. It is the most secure kind of salt, but implies that all requests MUST be done sequentially.
 * - "TIME" means that the service generates a salt based on a timestamp, so a signed request can be authenticated within a time window.
 */
export type SessionSaltKind = api.SessionSaltKind;

export type AssumeOptions = {
  login: string;
  kind: api.IdentityAccessKeyKind;
  keySet?: IdentityKeySet;
};

/**
 * A object that can be used to make authenticated request by a {@link_Session}.
 */
export interface SessionRequest<T> extends Request<T> {
  /**
   * An optional assume parameters to assume the request as another identity.
   */
  assume?: AssumeOptions;
}

export namespace Session {
  /**
   * Create a new session.
   * @param login The login of the identity to login with.
   * @param secret The secret of the identity.
   * @param options A collection of initialization options that control the sessions:
   *  - saltKind: The kind of salt used to sign authenticated requests to the DataPeps service. The default value is `TIME`. For more details see {@link SessionSaltKind}
   * @return(p) On success the promise will be resolved with a new session.
   * On error the promise will be rejected with an {@link Error} with kind
   * - `IdentityNotFound` if the `login` does not exists or if the identity has no secret.
   */
  export async function login(
    login: string,
    secret: string | Uint8Array,
    options?: LoginOptions
  ): Promise<Session> {
    let session = await Session.create(
      client,
      login,
      e => {
        let seed = MasterPrivateSeed.fromSecret(secret, e.masterSalt);
        let keySet = IdentityKeySet.recover(
          { login, version: e.version },
          seed,
          e as IdentityEncryptedKeySet
        );
        return keySet;
      },
      options
    );
    (session as any).secret = Uint8Tool.convert(secret);
    return session;
  }

  export async function create(
    client: Client,
    login: string,
    recover: (e: api.IdentityEncryptedKeySet) => IdentityKeySet,
    options: LoginOptions = { saltKind: api.SessionSaltKind.TIME }
  ): Promise<Session> {
    let { body: createResponse } = await client.doRequest({
      method: "POST",
      expectedCode: 201,
      path: "/api/v1/session/challenge/create",
      body: api.SessionCreateChallengeRequest.encode({
        login: login,
        saltKind: options.saltKind
      }).finish(),
      response: api.SessionCreateChallengeResponse.decode,
      headers: new Headers({
        "content-type": "application/x-protobuf"
      })
    });
    let encryption = recover(
      api.IdentityEncryptedKeySet.create(createResponse.encryption)
    );
    //await saveSessionState(sessionParams, encryption);
    let { body: resolveResponse } = await client.doRequest({
      method: "POST",
      expectedCode: 200,
      path: "/api/v1/session/challenge/resolve",
      body: api.SessionResolveChallengeRequest.encode({
        token: createResponse.token,
        salt: createResponse.salt,
        signature: encryption.sign(createResponse.salt)
      }).finish(),
      response: api.SessionResolveChallengeResponse.decode,
      headers: new Headers({
        "content-type": "application/x-protobuf"
      })
    });
    let sessionParams: SessionParameters = {
      token: createResponse.token,
      login: resolveResponse.login,
      salt: resolveResponse.salt,
      saltKind: createResponse.saltKind
    };
    encryption.id.login = login;
    return new SessionImpl(sessionParams, encryption, client);
  }
}

/**
 * A Session is used to perform authenticated requests to the DataPeps service and allows access to the authenticated API of the DataPeps service.
 */
export interface Session {
  /** The login of the {@link Identity} logged into the session */
  login: string;

  /**
   * Close the session.
   * @return(p) On success the promise will be resolved with void.
   */
  close(): Promise<void>;

  /**
   * Renew keys for the identity logged along with this session.
   * @param secret An optional secret to renew keys, if not retain the old secret as still valid.
   * @return(p) On success the promise will be resolved with void.
   */
  renewKeys(secret?: string | Uint8Array): Promise<void>;

  /**
   * Get the public key of the current session.
   * @return The public key of the current session.
   */
  getSessionPublicKey(): IdentityPublicKey;

  /**
   * Get the latest public key of the given identity login.
   * @param login The login of identity to get the key.
   * @return(p) On success the promise will be resolved with the public key of `login`.
   * On error the promise will be rejected with an {@link Error} with kind
   * - `IdentityNotFound` if the identity is not found.
   */
  getLatestPublicKey(login: string): Promise<IdentityPublicKey>;

  /**
   * Get the latest public key of a list of identities.
   * @param logins The login of identities to get the key.
   * @return(p) On success the promise will be resolved with list of the public key in the same order of the `logins` list.
   * On error the promise will be rejected with an {@link Error} with kind
   * - `IdentityNotFound` if an identity is not found.
   */
  getLatestPublicKeys(logins: string[]): Promise<IdentityPublicKey[]>;

  /**
   * Get a specific version of the public key of an identity.
   * @param id The id of the key to get.
   * @return(p) On success the promise will be resolved with the public key.
   * On error the promise will be rejected with an {@link Error} with kind
   * - `IdentityNotFound` if the identity is not found.
   */
  getPublicKey(id: IdentityPublicKeyID): Promise<IdentityPublicKey>;

  /**
   * Get specific versions of the public keys.
   * @param ids The ids of the keys to get.
   * @return(p) On success the promise will be resolved with a list of the public keys in the same order as the `ids` list.
   * On error the promise will be rejected with an {@link Error} with kind
   * - `IdentityNotFound` if an identity is not found.
   */
  getPublicKeys(ids: IdentityPublicKeyID[]): Promise<IdentityPublicKey[]>;

  getIdentityKeySet(login: string, version?: number): Promise<IdentityKeySet>;

  /**
   * Create a new session for an identity that the current session identity can access.
   * @param login The login of the identity to login with.
   */
  createSession(login: string): Promise<Session>;

  /**
   * Set the trust policy for the session, see {@link TrustPolicy} for more details.
   * @param policy The trust policy to set.
   */
  setTrustPolicy(policy: TrustPolicy);

  /**
   * Set the public keys cache for the session, see {@link PublicKeyCache} for more details.
   * @param cache The public key cache to set.
   */
  setPublicKeyCache(cache: PublicKeysCache);

  /**
   * Sign a message.
   */
  sign(message: Uint8Array);

  /**
   * Get the secret token of an identity.
   */
  getSecretToken(login: string): Promise<string>;

  /**
   * Do an authenticated request.
   * @param request
   */
  doRequest<T>(request: SessionRequest<T>): Promise<T>;

  /**
   * Do an authenticated proto request.
   * @param request
   */
  doProtoRequest<T>(request: SessionRequest<T>): Promise<T>;
}

export type LoginOptions = {
  saltKind?: api.SessionSaltKind;
};

export type SessionParameters = {
  token: Uint8Array;
  login: string;
  salt: Uint8Array;
  saltKind: api.SessionSaltKind;
};

class SessionImpl implements Session {
  login: string;
  secret: Uint8Array;
  private params: SessionParameters;
  private encryption: IdentityKeySet;
  private client: Client;

  private b64token: string; // base64 encoded
  private deltaSaltTime: number;

  private pkCache: PublicKeysCache;
  private trustPolicy: TrustPolicy;

  constructor(
    params: SessionParameters,
    encryption: IdentityKeySet,
    client: Client
  ) {
    this.login = params.login;

    this.params = params;
    this.encryption = encryption;
    this.client = client;

    this.b64token = Base64.encode(params.token);

    this.pkCache = new MemoryPublicKeyCache();
    this.trustPolicy = new TrustOnFirstUse(this);
    this.afterRequestHandleSalt();
  }

  async close(): Promise<void> {
    return await this.doProtoRequest<void>({
      method: "PUT",
      expectedCode: 200,
      path: "/api/v1/session/close"
    });
  }

  async renewKeys(secret?: string | Uint8Array): Promise<void> {
    await new IdentityAPI(this).renewKeys(this.login, secret);
    if (secret != null) {
      this.secret = Uint8Tool.convert(secret);
    }
    await this.unStale();
  }

  getSessionPublicKey(): IdentityPublicKey {
    let p = this.encryption.public();
    // TODO : p
    return {
      login: this.login,
      version: this.encryption.id.version,
      sign: p.sign,
      box: p.box
    };
  }

  async getLatestPublicKey(login: string): Promise<IdentityPublicKey> {
    let [key] = await this.getLatestPublicKeys([login]);
    return key;
  }

  async getLatestPublicKeys(logins: string[]): Promise<IdentityPublicKey[]> {
    let { chains } = await this.doProtoRequest({
      method: "POST",
      expectedCode: 200,
      path: "/api/v1/identities/latestPublicChains",
      body: api.IdentityGetLatestPublicChainsRequest.encode({
        ids: logins.map(login => {
          let pk = this.pkCache.latest(login);
          return { login, since: pk == null ? 0 : pk.version };
        })
      }).finish(),
      response: api.IdentityGetLatestPublicChainsResponse.decode
    });
    await this.validateChains(chains);
    return logins.map(login => this.pkCache.latest(login));
  }

  async getPublicKey(id: IdentityPublicKeyID): Promise<IdentityPublicKey> {
    let [key] = await this.getPublicKeys([id]);
    return key;
  }

  async getPublicKeys(
    ids: IdentityPublicKeyID[]
  ): Promise<IdentityPublicKey[]> {
    let requestIds: { [login: string]: number } = {};
    ids.forEach(id => {
      if (this.pkCache.get(id) != null) {
        return;
      }
      let version = requestIds[id.login];
      if (version == null || version < id.version) {
        requestIds[id.login] = id.version;
      }
    });
    let logins = Object.keys(requestIds);
    if (logins.length == 0) {
      return ids.map(id => this.pkCache.get(id));
    }
    let { chains } = await this.doProtoRequest({
      method: "POST",
      expectedCode: 200,
      path: "/api/v1/identities/publicChains",
      body: api.IdentityGetPublicChainsRequest.encode({
        ids: Object.keys(requestIds).map(login => {
          let pk = this.pkCache.latest(login);
          let since = pk == null ? 0 : pk.version;
          let version = requestIds[login];
          return { id: { login, version }, since };
        })
      }).finish(),
      response: api.IdentityGetPublicChainsResponse.decode
    });
    await this.validateChains(chains);
    return ids.map(id => this.pkCache.get(id));
  }

  async createSession(login: string): Promise<Session> {
    let keySet = await this.getIdentityKeySet(login);
    return await Session.create(client, login, () => {
      return keySet;
    });
  }

  setTrustPolicy(policy: TrustPolicy) {
    this.trustPolicy = policy;
  }

  setPublicKeyCache(cache: PublicKeysCache) {
    this.pkCache = cache;
  }

  async getSecretToken(login: string): Promise<string> {
    let keySet = await this.getIdentityKeySet(login);
    return Base64.encode(keySet.getSecretToken());
  }

  sign(message: Uint8Array): Uint8Array {
    return this.encryption.sign(message);
  }

  async doRequest<T>(request: SessionRequest<T>): Promise<T> {
    await this.addAuthHeaders(request);
    try {
      let response = await this.client.doRequest(request);
      this.handleResponseHeaders(response.headers);
      return response.body;
    } catch (err) {
      switch (err.kind) {
        case ServerKind.SessionStale:
          try {
            await this.unStale();
          } catch (e) {
            if (e instanceof Error && e.kind == SDKKind.IdentityInvalidKeySet) {
              throw err;
            }
            throw e;
          }
          return this.doRequest(request);
        case ServerKind.AssumeStale:
          return this.doRequest(request);
      }
      throw err;
    }
  }

  async doProtoRequest<T>(r: SessionRequest<T>): Promise<T> {
    r.headers = r.headers != null ? r.headers : new Headers();
    r.headers.set("content-type", "application/x-protobuf");
    return await this.doRequest(r);
  }

  private async validateChains(chains: api.IIdentityPublicChain[]) {
    await Promise.all(chains.map(chain => this.validateChain(chain)));
  }

  private async validateChain({
    login,
    version,
    chains
  }: api.IIdentityPublicChain) {
    // work on a duplicate of the chains parameter as shift() change the object
    chains = chains.slice();
    let firstVersion = version - chains.length;
    if (firstVersion < 0) {
      throw new Error({
        kind: SDKKind.InvalidServerChain,
        payload: { login, version, chains }
      });
    }
    let pk = this.pkCache.get({ login, version: firstVersion });

    if (firstVersion == 0) {
      if (pk == null) {
        let { box, sign, mandate } = chains.shift();
        pk = { login, version: 1, box, sign };
        await this.trustPolicy.trust(pk, mandate as IdentityPublicKeyID);
        this.pkCache.set({ login, version: 1 }, pk);
      }
      // Check if the server tries to erase the root key
      else if (
        !Uint8Tool.equals(pk.box, chains[0].box) ||
        !Uint8Tool.equals(pk.sign, chains[0].sign)
      ) {
        throw new Error({
          kind: SDKKind.IdentitySignChainInvalid,
          payload: { login, version: 1 }
        });
      }
    }
    // Check the sign chains and update the cache
    await chains.reduce(async (ppk, { box, sign, chain, mandate }) => {
      let pk = await ppk;
      let id = { login, version: pk.version + 1 };
      let pksign = pk.sign;
      if (mandate != null) {
        await this.trustPolicy.trust(pk, mandate as IdentityPublicKeyID);
        let mpk = await this.getPublicKey(mandate as IdentityPublicKeyID);
        pksign = mpk.sign;
      }
      if (
        !nacl.sign.detached.verify(Uint8Tool.concat(box, sign), chain, pksign)
      ) {
        throw new Error({
          kind: SDKKind.IdentitySignChainInvalid,
          payload: { login, version }
        });
      }
      pk = { login, version: id.version, box, sign };
      this.pkCache.set(id, pk);
      return pk;
    }, Promise.resolve(pk));
  }

  private handleResponseHeaders(headers: Headers) {
    let salt = headers.get("x-peps-salt");
    if (salt == null) {
      throw new Error({
        kind: SDKKind.ProtocolError,
        payload: { missing: "x-peps-salt", headers }
      });
    }
    this.params.salt = Base64.decode(salt);
    this.afterRequestHandleSalt();
  }

  private afterRequestHandleSalt() {
    let secondsServer =
      (this.params.salt[0] << 24) +
      (this.params.salt[1] << 16) +
      (this.params.salt[2] << 8) +
      this.params.salt[3];
    let secondsLocal = Math.floor(Date.now() / 1000);
    this.deltaSaltTime = secondsServer - secondsLocal;
  }

  private async addAuthHeaders(request: SessionRequest<any>) {
    // Add session headers
    let body = request.body;
    let headers = request.headers;
    let salt = this.getSalt();
    let assumeKeySet: IdentityKeySet;
    headers.set("x-peps-token", this.b64token);
    let tosign = body == null ? salt : Uint8Tool.concat(body, salt);
    // Add assume headers if needed
    if (request.assume != null) {
      assumeKeySet = await this.getIdentityKeySet(request.assume.login);
      let assumeKind = request.assume.kind;
      request.assume.keySet = assumeKeySet;
      headers.set("x-peps-assume-access", assumeKind.toString());
      headers.set(
        "x-peps-assume-identity",
        assumeKeySet.id.login + "/" + assumeKeySet.id.version
      );
      headers.set(
        "x-peps-assume-signature",
        Base64.encode(assumeKeySet.sign(tosign, assumeKind))
      );
    }
    headers.set("x-peps-salt", Base64.encode(salt));
    headers.set(
      "x-peps-signature",
      Base64.encode(this.encryption.sign(tosign))
    );
  }

  getSalt(): Uint8Array {
    switch (this.params.saltKind) {
      case api.SessionSaltKind.RAND:
        return this.params.salt;
      case api.SessionSaltKind.TIME:
        let seconds = Math.floor(Date.now() / 1000) + this.deltaSaltTime;
        let salt = new Uint8Array(4);
        salt[0] = (seconds >>> 24) & 0xff;
        salt[1] = (seconds >>> 16) & 0xff;
        salt[2] = (seconds >>> 8) & 0xff;
        salt[3] = seconds & 0xff;
        return salt;
    }
  }

  private unStale(): Promise<void> {
    return this.doProtoRequest({
      method: "PUT",
      expectedCode: 200,
      path: "/api/v1/session/unStale",
      response: api.SessionUnStaleResponse.decode
    }).then(({ encryption }) => {
      let seed = MasterPrivateSeed.fromSecret(
        this.secret,
        encryption.masterSalt
      );
      this.encryption = IdentityKeySet.recover(
        { login: this.encryption.id.login, version: encryption.version },
        seed,
        encryption as IdentityEncryptedKeySet
      );
    });
  }

  async resolveCipherList(ciphers: api.ICipher[]): Promise<SignedCipher[]> {
    let signs = ciphers.map(cipher => cipher.sign);
    let publicKeys = await this.getPublicKeys(signs as IdentityPublicKeyID[]);
    return ciphers.map(({ message, nonce, sign }) => {
      let pk = publicKeys.find(
        pk => sign.login == pk.login && sign.version == pk.version
      );
      if (pk == null) {
        throw new Error({
          kind: SDKKind.SDKInternalError,
          payload: { reason: "cannot find pk", sign }
        });
      }
      return { message, nonce, sign: pk };
    });
  }

  async decryptCipherList(
    type: CipherType,
    ciphers: api.ICipher[],
    secretKey?: Uint8Array
  ): Promise<Uint8Array> {
    let resolvedCiphers = await this.resolveCipherList(ciphers);
    let decryptor =
      secretKey == null
        ? this.encryption.decryptor(type)
        : IdentityKeySet.decryptor(type, secretKey);
    return decryptor.decryptList(resolvedCiphers);
  }

  async getIdentityKeySet(
    login: string,
    version?: number
  ): Promise<IdentityKeySet> {
    if (
      this.encryption.id.login == login &&
      (version == null || this.encryption.id.version == version)
    ) {
      return this.encryption;
    }
    let { path } = await this.doProtoRequest({
      method: "POST",
      path: "/api/v1/identity/" + encodeURI(login) + "/keySet",
      expectedCode: 200,
      body: api.IdentityGetKeySetRequest.encode({ version }).finish(),
      response: api.IdentityGetKeySetResponse.decode
    });
    if (path.length == 0) {
      throw new Error({
        kind: SDKKind.ProtocolError,
        payload: { message: "unexpected keySet path" }
      });
    }
    return path.reduce(IdentityKeySetAPI.recoverWithPathElt, this.encryption);
  }
}
