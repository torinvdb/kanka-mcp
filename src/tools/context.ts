import type { AuthProvider } from "../auth/index.js";
import type { CampaignSummary, KankaClient } from "../client/client.js";
import type { IdResolver } from "../services/id-resolver.js";
import type { TtlCache } from "../services/cache.js";
import type { ProfileService } from "../services/profile.js";
import type { UploadSettings } from "../services/upload-policy.js";
import type { KankaListResponse } from "../types.js";

export interface ToolContext {
  client: KankaClient;
  auth: AuthProvider;
  idResolver: IdResolver;
  campaignsCache: TtlCache<string, KankaListResponse<CampaignSummary>>;
  profile: ProfileService;
  /** Upload allowlist and size cap. Defaults to loadUploadSettings() read on each call. */
  uploadSettings?: () => UploadSettings;
}
