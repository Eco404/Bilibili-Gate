import { setupSearchPreviews } from './search-page-preview'
import { isInIframe, setupForNoneHomepage } from './shared'

export function initSearchPage() {
  if (isInIframe()) return // pagetual use iframe to load more
  setupForNoneHomepage()
  setupSearchPreviews()
}
