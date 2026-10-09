import { Rpc } from "@opencode/plugin/rpc"
import { Schema } from "effect"

export const OpencodeignoreRpc = Rpc.define({
  id: "opencodeignore",
  methods: {
    isIgnored: {
      input: Schema.Struct({ path: Schema.String }),
      output: Schema.Struct({ ignored: Schema.Boolean }),
    },
    listRules: {
      input: Schema.Struct({}),
      output: Schema.Struct({ root: Schema.String, rules: Schema.Array(Schema.String) }),
    },
  },
  events: {
    updated: {
      schema: Schema.Struct({ count: Schema.Number }),
    },
  },
})
