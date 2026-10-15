import type {
  DesktopUpdatesApi,
  DesktopUpdateStatus,
} from "../../src/shared/desktop-updates";
const status: DesktopUpdateStatus = {
  phase: "unavailable",
  currentVersion: "Demo",
  availableVersion: null,
  progress: null,
  checkedAt: null,
  message: "Install OpenTig to use updates and connect your repositories.",
  releaseUrl: null,
  releaseNotes: null,
};
export const canRestartForUpdate = () => true;
export const updatesApi = (): DesktopUpdatesApi => ({
  getStatus: async () => status,
  check: async () => status,
  download: async () => status,
  install: async () => status,
});
