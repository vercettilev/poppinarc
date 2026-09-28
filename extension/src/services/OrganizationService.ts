import { sendApiRequest } from "~/lib/fetchService"
import { Organization } from "./UserService"

export interface OrganizationSearchRequest {
  orgId: string
  subpath: string
}

export interface OrganizationSearchItem {
  id: string
  organization_id: string
  message: string
  url_path: string
  start_date: string
  end_date: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  comment_count: number
  organization: {
    id: string
    name: string
    owner_user_id: string
    badgeUrl?: string
    domain?: string
  }
  member_count: number
  user_role: string
  upvotes: number
  downvotes: number
}

export interface OrganizationSearchResponse {
  data: OrganizationSearchItem[]
  meta: {
    total: number
    subpath: string
    target_org_id: string
    target_org_name: string
  }
}

export class OrganizationService {
  /**
   * Search organizations with the provided criteria
   * @param subpath The subpath to search for
   * @returns Promise with organization search results
   */
  public static async searchOrganizations(subpath: string) {
    const orgId = (window as any).POPPIN_ID
    
    if (!orgId) {
      throw new Error("POPPIN_ID not found in window object")
    }

    return sendApiRequest<OrganizationSearchResponse>({
      url: "/organizations/search",
      method: "POST",
      data: {
        orgId,
        subpath,
      },
    })
  }


  public static async getOrganization(orgId: string) {
    return sendApiRequest<Organization>({
      url: "/organizations/" + orgId,
      method: "GET",
  
    })
  }
} 