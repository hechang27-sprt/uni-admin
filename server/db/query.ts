import { expressionBuilder } from "kysely";
import type { Database } from "./schema";

export function selectGrantedPermissions() {
  const eb = expressionBuilder<Database>();
  return eb
    .selectFrom("tenantMemberships as tu")
    .innerJoin("userRoleAssignments as assigned", (join) =>
      join
        .onRef("assigned.userId", "=", "tu.userId")
        .onRef("assigned.tenantId", "=", "tu.tenantId")
        .on("tu.status", "=", "active"),
    )
    .innerJoin("rolePermissions as rp", (join) =>
      join
        .onRef("rp.roleId", "=", "assigned.roleId")
        .onRef("rp.tenantId", "=", "tu.tenantId"),
    )
    .innerJoin("permissions as p", "p.permissionId", "rp.permissionId")
    .innerJoin("authScopeClosure as c", (join) =>
      join
        .onRef("c.ancestorId", "=", "assigned.scopeId")
        .onRef("c.tenantId", "=", "tu.tenantId"),
    );
}
