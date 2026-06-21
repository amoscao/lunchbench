export const onRequest: PagesFunction = async (context) => {
  const country = (context.request as Request & { cf?: { country?: string } }).cf?.country

  if (country && country !== 'US') {
    return new Response('Access restricted to US visitors.', { status: 403 })
  }

  return context.next()
}
