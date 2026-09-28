import { backendApi } from "~/lib/axios";

export const setCommonHeaders = (commonHeaders: Record<string, string>) => {
  backendApi.defaults.headers.common = {
    ...backendApi.defaults.headers.common,
    ...commonHeaders,
  };
};
