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
 * @type { ProjectKind }
 */
export type ProjectKind =
  | 'whiteboard'
  | 'doc'
;

export function decodeProjectKind(rawInput: unknown): ProjectKind | null {
  switch (rawInput) {
    case 'whiteboard':
    case 'doc':
     return rawInput;
  }
  return null;
}

export function _decodeProjectKind(rawInput: unknown): ProjectKind | undefined {
  switch (rawInput) {
    case 'whiteboard':
    case 'doc':
    return rawInput;
  }
  return;
}

/**
 * @type { ShareRole }
 */
export type ShareRole =
  | 'viewer'
  | 'editor'
;

export function decodeShareRole(rawInput: unknown): ShareRole | null {
  switch (rawInput) {
    case 'viewer':
    case 'editor':
     return rawInput;
  }
  return null;
}

export function _decodeShareRole(rawInput: unknown): ShareRole | undefined {
  switch (rawInput) {
    case 'viewer':
    case 'editor':
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
   * @type { ProjectKind }
   * @memberof ProjectRow
  */
  kind: ProjectKind;
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
   * @type { string }
   * @memberof ProjectRow
  */
  link_expires_at: string | null;
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
    const decodedKind = decodeProjectKind(rawInput['kind']);
    const decodedScene = decodeUnknown(rawInput['scene']);
    const decodedVisibility = decodeVisibility(rawInput['visibility']);
    const decodedLinkExpiresAt = decodeString(rawInput['link_expires_at']);
    const decodedPosition = decodeNumber(rawInput['position']);
    const decodedCreatedAt = decodeString(rawInput['created_at']);
    const decodedUpdatedAt = decodeString(rawInput['updated_at']);

    if (
      decodedId === null ||
      decodedWorkspaceId === null ||
      decodedName === null ||
      decodedKind === null ||
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
      kind: decodedKind,
      scene: decodedScene,
      visibility: decodedVisibility,
      link_expires_at: decodedLinkExpiresAt,
      position: decodedPosition,
      created_at: decodedCreatedAt,
      updated_at: decodedUpdatedAt
    };
  }
  return null;
}


/**
 * @type { ProjectShareRow }
 */
export type ProjectShareRow = {
  /**
   * @type { string }
   * @memberof ProjectShareRow
  */
  id: string;
  /**
   * @type { string }
   * @memberof ProjectShareRow
  */
  project_id: string;
  /**
   * @type { string }
   * @memberof ProjectShareRow
  */
  email: string;
  /**
   * @type { ShareRole }
   * @memberof ProjectShareRow
  */
  role: ShareRole;
  /**
   * @type { string }
   * @memberof ProjectShareRow
  */
  added_by: string | null;
    /**
   * @type { string }
   * @memberof ProjectShareRow
  */
  created_at: string;
};

export function decodeProjectShareRow(rawInput: unknown): ProjectShareRow | null {
  if (isJSON(rawInput)) {
    const decodedId = decodeString(rawInput['id']);
    const decodedProjectId = decodeString(rawInput['project_id']);
    const decodedEmail = decodeString(rawInput['email']);
    const decodedRole = decodeShareRole(rawInput['role']);
    const decodedAddedBy = decodeString(rawInput['added_by']);
    const decodedCreatedAt = decodeString(rawInput['created_at']);

    if (
      decodedId === null ||
      decodedProjectId === null ||
      decodedEmail === null ||
      decodedRole === null ||
      decodedCreatedAt === null
    ) {
      return null;
    }

    return {
      id: decodedId,
      project_id: decodedProjectId,
      email: decodedEmail,
      role: decodedRole,
      added_by: decodedAddedBy,
      created_at: decodedCreatedAt
    };
  }
  return null;
}


/**
 * @type { DocumentRow }
 */
export type DocumentRow = {
  /**
   * @type { string }
   * @memberof DocumentRow
  */
  id: string;
  /**
   * @type { string }
   * @memberof DocumentRow
  */
  project_id: string;
  /**
   * @type { string }
   * @memberof DocumentRow
  */
  name: string;
  /**
   * @type { string }
   * @memberof DocumentRow
  */
  content: string;
  /**
   * @type { number }
   * @memberof DocumentRow
  */
  position: number | null;
    /**
   * @type { string }
   * @memberof DocumentRow
  */
  created_at: string;
  /**
   * @type { string }
   * @memberof DocumentRow
  */
  updated_at: string;
};

export function decodeDocumentRow(rawInput: unknown): DocumentRow | null {
  if (isJSON(rawInput)) {
    const decodedId = decodeString(rawInput['id']);
    const decodedProjectId = decodeString(rawInput['project_id']);
    const decodedName = decodeString(rawInput['name']);
    const decodedContent = decodeString(rawInput['content']);
    const decodedPosition = decodeNumber(rawInput['position']);
    const decodedCreatedAt = decodeString(rawInput['created_at']);
    const decodedUpdatedAt = decodeString(rawInput['updated_at']);

    if (
      decodedId === null ||
      decodedProjectId === null ||
      decodedName === null ||
      decodedContent === null ||
      decodedCreatedAt === null ||
      decodedUpdatedAt === null
    ) {
      return null;
    }

    return {
      id: decodedId,
      project_id: decodedProjectId,
      name: decodedName,
      content: decodedContent,
      position: decodedPosition,
      created_at: decodedCreatedAt,
      updated_at: decodedUpdatedAt
    };
  }
  return null;
}


/**
 * @type { DocumentCommentRow }
 */
export type DocumentCommentRow = {
  /**
   * @type { string }
   * @memberof DocumentCommentRow
  */
  id: string;
  /**
   * @type { string }
   * @memberof DocumentCommentRow
  */
  document_id: string;
  /**
   * @type { string }
   * @memberof DocumentCommentRow
  */
  parent_id: string | null;
    /**
   * @type { string }
   * @memberof DocumentCommentRow
  */
  body: string;
  /**
   * @type { string }
   * @memberof DocumentCommentRow
  */
  anchor_quote: string | null;
    /**
   * @type { string }
   * @memberof DocumentCommentRow
  */
  anchor_prefix: string;
  /**
   * @type { string }
   * @memberof DocumentCommentRow
  */
  anchor_suffix: string;
  /**
   * @type { number }
   * @memberof DocumentCommentRow
  */
  anchor_start: number | null;
    /**
   * @type { number }
   * @memberof DocumentCommentRow
  */
  anchor_end: number | null;
    /**
   * @type { string }
   * @memberof DocumentCommentRow
  */
  created_by: string | null;
    /**
   * @type { string }
   * @memberof DocumentCommentRow
  */
  created_at: string;
  /**
   * @type { string }
   * @memberof DocumentCommentRow
  */
  resolved_at: string | null;
    /**
   * @type { string }
   * @memberof DocumentCommentRow
  */
  resolved_by: string | null;
  };

export function decodeDocumentCommentRow(rawInput: unknown): DocumentCommentRow | null {
  if (isJSON(rawInput)) {
    const decodedId = decodeString(rawInput['id']);
    const decodedDocumentId = decodeString(rawInput['document_id']);
    const decodedParentId = decodeString(rawInput['parent_id']);
    const decodedBody = decodeString(rawInput['body']);
    const decodedAnchorQuote = decodeString(rawInput['anchor_quote']);
    const decodedAnchorPrefix = decodeString(rawInput['anchor_prefix']);
    const decodedAnchorSuffix = decodeString(rawInput['anchor_suffix']);
    const decodedAnchorStart = decodeNumber(rawInput['anchor_start']);
    const decodedAnchorEnd = decodeNumber(rawInput['anchor_end']);
    const decodedCreatedBy = decodeString(rawInput['created_by']);
    const decodedCreatedAt = decodeString(rawInput['created_at']);
    const decodedResolvedAt = decodeString(rawInput['resolved_at']);
    const decodedResolvedBy = decodeString(rawInput['resolved_by']);

    if (
      decodedId === null ||
      decodedDocumentId === null ||
      decodedBody === null ||
      decodedAnchorPrefix === null ||
      decodedAnchorSuffix === null ||
      decodedCreatedAt === null
    ) {
      return null;
    }

    return {
      id: decodedId,
      document_id: decodedDocumentId,
      parent_id: decodedParentId,
      body: decodedBody,
      anchor_quote: decodedAnchorQuote,
      anchor_prefix: decodedAnchorPrefix,
      anchor_suffix: decodedAnchorSuffix,
      anchor_start: decodedAnchorStart,
      anchor_end: decodedAnchorEnd,
      created_by: decodedCreatedBy,
      created_at: decodedCreatedAt,
      resolved_at: decodedResolvedAt,
      resolved_by: decodedResolvedBy
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


/**
 * @type { ApiTokenRow }
 */
export type ApiTokenRow = {
  /**
   * @type { string }
   * @memberof ApiTokenRow
  */
  id: string;
  /**
   * @type { string }
   * @memberof ApiTokenRow
  */
  user_id: string;
  /**
   * @type { string }
   * @memberof ApiTokenRow
  */
  name: string;
  /**
   * @type { string }
   * @memberof ApiTokenRow
  */
  token_hash: string;
  /**
   * @type { string }
   * @memberof ApiTokenRow
  */
  token_prefix: string;
  /**
   * @type { string }
   * @memberof ApiTokenRow
  */
  created_at: string;
  /**
   * @type { string }
   * @memberof ApiTokenRow
  */
  last_used_at: string | null;
    /**
   * @type { string }
   * @memberof ApiTokenRow
  */
  expires_at: string | null;
  };

export function decodeApiTokenRow(rawInput: unknown): ApiTokenRow | null {
  if (isJSON(rawInput)) {
    const decodedId = decodeString(rawInput['id']);
    const decodedUserId = decodeString(rawInput['user_id']);
    const decodedName = decodeString(rawInput['name']);
    const decodedTokenHash = decodeString(rawInput['token_hash']);
    const decodedTokenPrefix = decodeString(rawInput['token_prefix']);
    const decodedCreatedAt = decodeString(rawInput['created_at']);
    const decodedLastUsedAt = decodeString(rawInput['last_used_at']);
    const decodedExpiresAt = decodeString(rawInput['expires_at']);

    if (
      decodedId === null ||
      decodedUserId === null ||
      decodedName === null ||
      decodedTokenHash === null ||
      decodedTokenPrefix === null ||
      decodedCreatedAt === null
    ) {
      return null;
    }

    return {
      id: decodedId,
      user_id: decodedUserId,
      name: decodedName,
      token_hash: decodedTokenHash,
      token_prefix: decodedTokenPrefix,
      created_at: decodedCreatedAt,
      last_used_at: decodedLastUsedAt,
      expires_at: decodedExpiresAt
    };
  }
  return null;
}




