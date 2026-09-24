export const setSharedAccessToken = (token: string) => {
  localStorage.setItem("shared_access_token", token);
};