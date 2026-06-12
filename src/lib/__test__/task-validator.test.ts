import { describe, expect, it } from "vitest";
import { fieldSchema, taskSchemaValidator } from "../task-validator";

describe("fieldSchema", () => {
  it("accepts valid field", () => {
    const result = fieldSchema.safeParse({
      name: "user_name",
      type: "String",
      required: true,
      description: "用户姓名",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty field name", () => {
    const result = fieldSchema.safeParse({
      name: "",
      type: "String",
      required: false,
      description: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("字段名不能为空");
    }
  });

  it("rejects field name with uppercase", () => {
    const result = fieldSchema.safeParse({
      name: "UserName",
      type: "String",
      required: false,
      description: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("小写字母");
    }
  });

  it("rejects field name starting with number", () => {
    const result = fieldSchema.safeParse({
      name: "1user",
      type: "String",
      required: false,
      description: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts field name with underscore and numbers", () => {
    const result = fieldSchema.safeParse({
      name: "phone_2",
      type: "Number",
      required: false,
      description: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects description over 200 chars", () => {
    const result = fieldSchema.safeParse({
      name: "email",
      type: "String",
      required: false,
      description: "x".repeat(201),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("200");
    }
  });

  it("rejects invalid type", () => {
    const result = fieldSchema.safeParse({
      name: "email",
      type: "Boolean",
      required: false,
      description: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts Date type field", () => {
    const result = fieldSchema.safeParse({
      name: "created_date",
      type: "Date",
      required: true,
      description: "创建日期",
    });
    expect(result.success).toBe(true);
  });
});

describe("taskSchemaValidator", () => {
  it("accepts valid array of fields", () => {
    const result = taskSchemaValidator.safeParse({
      fields: [
        { name: "email", type: "String", required: true, description: "邮箱" },
        { name: "phone", type: "String", required: false, description: "电话" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects duplicate field names", () => {
    const result = taskSchemaValidator.safeParse({
      fields: [
        { name: "user_name", type: "String", required: true, description: "" },
        { name: "user_name", type: "Number", required: false, description: "" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        "同一任务中的字段名不能重复",
      );
    }
  });

  it("accepts empty fields array", () => {
    const result = taskSchemaValidator.safeParse({
      fields: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects if any field is invalid", () => {
    const result = taskSchemaValidator.safeParse({
      fields: [
        { name: "valid", type: "String", required: false, description: "" },
        { name: "", type: "String", required: false, description: "" },
      ],
    });
    expect(result.success).toBe(false);
  });
});
