declare namespace chrome {
  namespace tabs {
    function create(createProperties: {
      url?: string
      active?: boolean
      pinned?: boolean
    }): Promise<chrome.tabs.Tab>
  }
}
