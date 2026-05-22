import { isJSON, decodeString, _decodeString , decodeUnknown, _decodeUnknown , decodeNumber, _decodeNumber , decodeBoolean, _decodeBoolean , decodeArray, _decodeArray  } from 'type-decoder';

/**
 * @type { Visibility }
 */
export type Visibility =
  | 'private'
  | 'link'
;

export function decodeVisibility(rawInput: unknown): Visibility | null {
  switch (rawInput) {
    case 'private':
    case 'link':
     return rawInput;
  }
  return null;
}

export function _decodeVisibility(rawInput: unknown): Visibility | undefined {
  switch (rawInput) {
    case 'private':
    case 'link':
    return rawInput;
  }
  return;
}

/**
 * @type { ProjectRow }
 */
export type ProjectRow = {
  /**
   * @type { string }
   * @memberof ProjectRow
  */
  id: string;
  /**
   * @type { string }
   * @memberof ProjectRow
  */
  workspace_id: string;
  /**
   * @type { string }
   * @memberof ProjectRow
  */
  name: string;
  /**
   * @type { unknown }
   * @memberof ProjectRow
  */
  scene: unknown | null;
    /**
   * @type { Visibility }
   * @memberof ProjectRow
  */
  visibility: Visibility;
  /**
   * @type { number }
   * @memberof ProjectRow
  */
  position: number | null;
    /**
   * @type { string }
   * @memberof ProjectRow
  */
  created_at: string;
  /**
   * @type { string }
   * @memberof ProjectRow
  */
  updated_at: string;
};

export function decodeProjectRow(rawInput: unknown): ProjectRow | null {
  if (isJSON(rawInput)) {
    const decodedId = decodeString(rawInput['id']);
    const decodedWorkspaceId = decodeString(rawInput['workspace_id']);
    const decodedName = decodeString(rawInput['name']);
    const decodedScene = decodeUnknown(rawInput['scene']);
    const decodedVisibility = decodeVisibility(rawInput['visibility']);
    const decodedPosition = decodeNumber(rawInput['position']);
    const decodedCreatedAt = decodeString(rawInput['created_at']);
    const decodedUpdatedAt = decodeString(rawInput['updated_at']);

    if (
      decodedId === null ||
      decodedWorkspaceId === null ||
      decodedName === null ||
      decodedVisibility === null ||
      decodedCreatedAt === null ||
      decodedUpdatedAt === null
    ) {
      return null;
    }

    return {
      id: decodedId,
      workspace_id: decodedWorkspaceId,
      name: decodedName,
      scene: decodedScene,
      visibility: decodedVisibility,
      position: decodedPosition,
      created_at: decodedCreatedAt,
      updated_at: decodedUpdatedAt
    };
  }
  return null;
}


/**
 * @type { WorkspaceRow }
 */
export type WorkspaceRow = {
  /**
   * @type { string }
   * @memberof WorkspaceRow
  */
  id: string;
  /**
   * @type { string }
   * @memberof WorkspaceRow
  */
  name: string;
  /**
   * @type { string }
   * @memberof WorkspaceRow
  */
  owner_id: string;
  /**
   * @type { string }
   * @memberof WorkspaceRow
  */
  created_at: string;
  /**
   * @type { string }
   * @memberof WorkspaceRow
  */
  updated_at: string;
};

export function decodeWorkspaceRow(rawInput: unknown): WorkspaceRow | null {
  if (isJSON(rawInput)) {
    const decodedId = decodeString(rawInput['id']);
    const decodedName = decodeString(rawInput['name']);
    const decodedOwnerId = decodeString(rawInput['owner_id']);
    const decodedCreatedAt = decodeString(rawInput['created_at']);
    const decodedUpdatedAt = decodeString(rawInput['updated_at']);

    if (
      decodedId === null ||
      decodedName === null ||
      decodedOwnerId === null ||
      decodedCreatedAt === null ||
      decodedUpdatedAt === null
    ) {
      return null;
    }

    return {
      id: decodedId,
      name: decodedName,
      owner_id: decodedOwnerId,
      created_at: decodedCreatedAt,
      updated_at: decodedUpdatedAt
    };
  }
  return null;
}


/**
 * @type { AppMemberRow }
 */
export type AppMemberRow = {
  /**
   * @type { string }
   * @memberof AppMemberRow
  */
  email: string;
  /**
   * @type { boolean }
   * @memberof AppMemberRow
  */
  is_admin: boolean;
  /**
   * @type { string }
   * @memberof AppMemberRow
  */
  added_by: string | null;
    /**
   * @type { string }
   * @memberof AppMemberRow
  */
  created_at: string;
};

export function decodeAppMemberRow(rawInput: unknown): AppMemberRow | null {
  if (isJSON(rawInput)) {
    const decodedEmail = decodeString(rawInput['email']);
    const decodedIsAdmin = decodeBoolean(rawInput['is_admin']);
    const decodedAddedBy = decodeString(rawInput['added_by']);
    const decodedCreatedAt = decodeString(rawInput['created_at']);

    if (
      decodedEmail === null ||
      decodedIsAdmin === null ||
      decodedCreatedAt === null
    ) {
      return null;
    }

    return {
      email: decodedEmail,
      is_admin: decodedIsAdmin,
      added_by: decodedAddedBy,
      created_at: decodedCreatedAt
    };
  }
  return null;
}


/**
 * @type { PasskeyRow }
 */
export type PasskeyRow = {
  /**
   * @type { string }
   * @memberof PasskeyRow
  */
  credential_id: string;
  /**
   * @type { string }
   * @memberof PasskeyRow
  */
  user_id: string;
  /**
   * @type { string }
   * @memberof PasskeyRow
  */
  public_key: string;
  /**
   * @type { number }
   * @memberof PasskeyRow
  */
  counter: number;
  /**
   * @type { string[] }
   * @memberof PasskeyRow
  */
  transports: string[];
  /**
   * @type { string }
   * @memberof PasskeyRow
  */
  device_type: string | null;
    /**
   * @type { boolean }
   * @memberof PasskeyRow
  */
  backed_up: boolean;
  /**
   * @type { string }
   * @memberof PasskeyRow
  */
  device_name: string | null;
    /**
   * @type { string }
   * @memberof PasskeyRow
  */
  created_at: string;
  /**
   * @type { string }
   * @memberof PasskeyRow
  */
  last_used_at: string | null;
  };

export function decodePasskeyRow(rawInput: unknown): PasskeyRow | null {
  if (isJSON(rawInput)) {
    const decodedCredentialId = decodeString(rawInput['credential_id']);
    const decodedUserId = decodeString(rawInput['user_id']);
    const decodedPublicKey = decodeString(rawInput['public_key']);
    const decodedCounter = decodeNumber(rawInput['counter']);
    const decodedTransports = decodeArray(rawInput['transports'],decodeString);
    const decodedDeviceType = decodeString(rawInput['device_type']);
    const decodedBackedUp = decodeBoolean(rawInput['backed_up']);
    const decodedDeviceName = decodeString(rawInput['device_name']);
    const decodedCreatedAt = decodeString(rawInput['created_at']);
    const decodedLastUsedAt = decodeString(rawInput['last_used_at']);

    if (
      decodedCredentialId === null ||
      decodedUserId === null ||
      decodedPublicKey === null ||
      decodedCounter === null ||
      decodedTransports === null ||
      decodedBackedUp === null ||
      decodedCreatedAt === null
    ) {
      return null;
    }

    return {
      credential_id: decodedCredentialId,
      user_id: decodedUserId,
      public_key: decodedPublicKey,
      counter: decodedCounter,
      transports: decodedTransports,
      device_type: decodedDeviceType,
      backed_up: decodedBackedUp,
      device_name: decodedDeviceName,
      created_at: decodedCreatedAt,
      last_used_at: decodedLastUsedAt
    };
  }
  return null;
}


/**
 * @type { AppInviteRow }
 */
export type AppInviteRow = {
  /**
   * @type { string }
   * @memberof AppInviteRow
  */
  token: string;
  /**
   * @type { string }
   * @memberof AppInviteRow
  */
  created_by: string | null;
    /**
   * @type { boolean }
   * @memberof AppInviteRow
  */
  grant_admin: boolean;
  /**
   * @type { number }
   * @memberof AppInviteRow
  */
  max_uses: number | null;
    /**
   * @type { number }
   * @memberof AppInviteRow
  */
  use_count: number;
  /**
   * @type { string }
   * @memberof AppInviteRow
  */
  expires_at: string | null;
    /**
   * @type { string }
   * @memberof AppInviteRow
  */
  note: string | null;
    /**
   * @type { string }
   * @memberof AppInviteRow
  */
  created_at: string;
};

export function decodeAppInviteRow(rawInput: unknown): AppInviteRow | null {
  if (isJSON(rawInput)) {
    const decodedToken = decodeString(rawInput['token']);
    const decodedCreatedBy = decodeString(rawInput['created_by']);
    const decodedGrantAdmin = decodeBoolean(rawInput['grant_admin']);
    const decodedMaxUses = decodeNumber(rawInput['max_uses']);
    const decodedUseCount = decodeNumber(rawInput['use_count']);
    const decodedExpiresAt = decodeString(rawInput['expires_at']);
    const decodedNote = decodeString(rawInput['note']);
    const decodedCreatedAt = decodeString(rawInput['created_at']);

    if (
      decodedToken === null ||
      decodedGrantAdmin === null ||
      decodedUseCount === null ||
      decodedCreatedAt === null
    ) {
      return null;
    }

    return {
      token: decodedToken,
      created_by: decodedCreatedBy,
      grant_admin: decodedGrantAdmin,
      max_uses: decodedMaxUses,
      use_count: decodedUseCount,
      expires_at: decodedExpiresAt,
      note: decodedNote,
      created_at: decodedCreatedAt
    };
  }
  return null;
}


/**
 * @type { PasskeyRegisterFinishBody }
 */
export type PasskeyRegisterFinishBody = {
  /**
   * @type { unknown }
   * @memberof PasskeyRegisterFinishBody
  */
  response: unknown;
  /**
   * @type { string }
   * @memberof PasskeyRegisterFinishBody
  */
  deviceName: string | null;
  };

export function decodePasskeyRegisterFinishBody(rawInput: unknown): PasskeyRegisterFinishBody | null {
  if (isJSON(rawInput)) {
    const decodedResponse = decodeUnknown(rawInput['response']);
    const decodedDeviceName = decodeString(rawInput['deviceName']);

    if (
      decodedResponse === null
    ) {
      return null;
    }

    return {
      response: decodedResponse,
      deviceName: decodedDeviceName
    };
  }
  return null;
}


/**
 * @type { PasskeyLoginBody }
 */
export type PasskeyLoginBody = {
  /**
   * @type { string }
   * @memberof PasskeyLoginBody
  */
  email: string | null;
    /**
   * @type { unknown }
   * @memberof PasskeyLoginBody
  */
  response: unknown | null;
  };

export function decodePasskeyLoginBody(rawInput: unknown): PasskeyLoginBody | null {
  if (isJSON(rawInput)) {
    const decodedEmail = decodeString(rawInput['email']);
    const decodedResponse = decodeUnknown(rawInput['response']);


    return {
      email: decodedEmail,
      response: decodedResponse
    };
  }
  return null;
}




