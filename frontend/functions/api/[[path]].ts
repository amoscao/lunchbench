export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url)
  const workerUrl = 'https://lunchbench-api.woodamca.workers.dev'
  const targetUrl = workerUrl + url.pathname + url.search

  return fetch(targetUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
  })
}
