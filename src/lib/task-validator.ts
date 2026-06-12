import { z } from "zod";

export const fieldSchema = z.object({
  name: z
    .string()
    .min(1, "字段名不能为空")
    .regex(
      /^[a-z_][a-z0-9_]*$/,
      "字段名必须以小写字母或下划线开头，且只能包含小写字母、数字和下划线",
    ),
  type: z.enum(["String", "Number", "Date"]),
  required: z.boolean(),
  description: z.string().max(200, "说明文字不能超过 200 个字符"),
});

export const taskSchemaValidator = z.object({
  fields: z.array(fieldSchema).refine(
    (fields) => {
      const names = fields.map((f) => f.name);
      return new Set(names).size === names.length;
    },
    { message: "同一任务中的字段名不能重复" },
  ),
});

export type FieldInput = z.infer<typeof fieldSchema>;
export type TaskSchemaInput = z.infer<typeof taskSchemaValidator>;
