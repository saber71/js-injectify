import { describe, expect, test } from "vitest"
import { Inject, Injectable } from "../src"
import { Metadata } from "../src"

describe("decorator.test", () => {
  test("检查Metadata中的类型信息", () => {
    class Parent {
      @Inject()
      cc: string = ""
    }

    class B {}

    type great = "123" | "sa" | number

    @Injectable({
      paramtypes: { 0: "不生效", 1: "String" },
      moduleName: "test",
      singleton: true,
      createImmediately: true
    })
    class A extends Parent {
      @Inject()
      b: great = "123"
      @Inject({ typeLabel: "Number" })
      aaa: string = ""

      constructor(
        //@ts-ignore
        @Inject({ typeLabel: "aaa" })
        readonly a: string,
        bb: great,
        bbb: B
      ) {
        super()
      }

      @Inject({ paramtypes: { 0: "Boolean" } })
      func(
        arg1: string,
        //@ts-ignore
        @Inject({ typeLabel: "AAA" }) arg2: number,
        arg3: B
      ) {}
    }

    @Injectable({ overrideConstructor: false })
    class C extends A {}

    const metadata = new Metadata(A)
    metadata.getMethodParameterTypes().types.push("aaa", "String", "B")
    metadata.getMethodParameterTypes("func").types.push("Boolean", "AAA", "B")
    metadata.fieldTypes["b"] = { type: "Object", getter: undefined }
    metadata.fieldTypes["aaa"] = { type: "Number", getter: undefined }
    metadata.fieldTypes["cc"] = { type: "String", getter: undefined }
    metadata.parentClassNames.push("Parent")
    metadata.injectable = true
    metadata.moduleName = "test"
    metadata.singleton = true
    metadata.createImmediately = true

    expect(Metadata.getOrCreate(A)).toEqual(metadata)

    const metadataForC = Metadata.getOrCreate(C)
    expect(metadataForC.getMethodParameterTypes().types).toEqual(
      Metadata.getOrCreate(A).getMethodParameterTypes().types
    )
  })
})
