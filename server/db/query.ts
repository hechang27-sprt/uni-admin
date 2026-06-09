import { expressionBuilder } from "kysely";
import type { Database } from "./schema";

export function selectTenantUsers(input?: {
  activeUser?: boolean;
  activeMember?: boolean;
}) {
  const { activeUser = true, activeMember: activeTenant = true } = input ?? {};

  const eb = expressionBuilder<Database>();
  return eb
    .selectFrom("tenantMemberships as tu")

    .innerJoin("users", (join) => {
      let jb = join.onRef("users.userId", "=", "tu.userId");

      if (activeTenant) {
        jb = jb.on("tu.status", "=", "active");
      }

      if (activeUser) {
        jb = jb.on("users.status", "=", "active");
      }

      return jb;
    });
}

export function selectGrantedPermissions() {
  return selectTenantUsers()
    .innerJoin("userRoleAssignments as assigned", (join) =>
      join
        .onRef("assigned.userId", "=", "tu.userId")
        .onRef("assigned.tenantId", "=", "tu.tenantId"),
    )
    .innerJoin("rolePermissions as rp", (join) =>
      join
        .onRef("rp.roleId", "=", "assigned.roleId")
        .onRef("rp.tenantId", "=", "tu.tenantId"),
    )
    .innerJoin("permissions as p", "p.key", "rp.permissionKey")
    .innerJoin("authScopeClosure as c", (join) =>
      join
        .onRef("c.ancestorId", "=", "assigned.scopeId")
        .onRef("c.tenantId", "=", "tu.tenantId"),
    );
}
