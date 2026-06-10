export const users = createTable("users", {
  id: integer().primaryKey(),
  createdAt: timestamp(),   // camelCase column
  fullName: text(),
});
