import type { Class } from "@heraclius/js-tools"
import { deepAssign } from "@heraclius/js-tools"
import type { FieldType, MethodParameterTypes } from "./types"

/* 收集类的元信息，包括字段类型、构造函数入参类型 */
export class Metadata {
  /* 类名映射Metadata对象，如果存在子类，会用子类的Metadata对象合并父类的Metadata对象 */
  private static readonly _classNameMapMetadata = new Map<string, Metadata>()

  /* 获取所有的Metadata对象 */
  static getAllMetadata() {
    return this._classNameMapMetadata.values()
  }

  /**
   * 获取类对应的Metadata对象，如果对象不存在就新建一个。在新建Metadata对象的时候，子类的Metadata对象会合并父类的Metadata对象
   * @param clazzOrPrototype 可以是类或是类的原型
   */
  static getOrCreate(clazzOrPrototype: Class | object) {
    // 根据输入获取类的构造函数
    let clazz: Class
    if (typeof clazzOrPrototype === "object") clazz = clazzOrPrototype.constructor as Class
    else clazz = clazzOrPrototype

    // 尝试从映射中获取Metadata对象，如果不存在则创建新对象
    let metadata = this._classNameMapMetadata.get(clazz.name)
    if (!metadata) {
      this._classNameMapMetadata.set(clazz.name, (metadata = new Metadata(clazz)))

      // 合并父类的Metadata
      let p = Object.getPrototypeOf(clazz)
      let merged = false
      while (p?.name) {
        metadata.parentClassNames.push(p.name)
        if (!merged) {
          let parentMetadata = this._classNameMapMetadata.get(p.name)
          if (parentMetadata && parentMetadata !== metadata) {
            merged = true
            metadata._merge(parentMetadata)
          }
        }
        p = Object.getPrototypeOf(p)
      }
    }
    return metadata
  }

  static get(clazzOrPrototype: Class | object) {
    // 根据输入获取类的构造函数
    let clazz: Class
    if (typeof clazzOrPrototype === "object") clazz = clazzOrPrototype.constructor as Class
    else clazz = clazzOrPrototype

    // 获取指定类的Metadata对象
    return this._classNameMapMetadata.get(clazz.name)
  }

  constructor(readonly clazz: Class) {}

  /* 标识类是否已被装饰器Injectable装饰 */
  injectable = false

  /* 类所属的模块 */
  moduleName?: string

  /* 类是否是单例的 */
  singleton?: boolean

  /* 类是否立即实例化 */
  createImmediately?: boolean

  /* 标记该类的构造函数入参类型是否是从父类复制的 */
  copiedConstructorParams = false

  /* 当Injectable装饰的类生成实例时调用 */
  onCreate?: (instance: object) => void

  overrideParent?: boolean

  /* 保存方法的入参类型。key为方法名 */
  readonly methodNameMapParameterTypes: Record<string, MethodParameterTypes> = {}

  /* 字段名映射其类型名 */
  private _fieldTypes: Record<string, FieldType> = {}
  get fieldTypes(): Record<string, FieldType> {
    return this._fieldTypes
  }

  /* 父类的名字 */
  readonly parentClassNames: string[] = []

  /* 保存用户自定义数据 */
  private _userData: Record<string, any> = {}
  get userData() {
    return this._userData
  }

  /* 根据方法名获取保存了入参类型的数据结构 */
  getMethodParameterTypes(methodName: string = "_constructor"): MethodParameterTypes {
    // 默认为构造函数方法名
    if (methodName === "constructor") methodName = "_" + methodName

    // 若方法的入参类型数据未初始化，则初始化之
    if (!this.methodNameMapParameterTypes[methodName])
      this.methodNameMapParameterTypes[methodName] = {
        types: [],
        getters: {},
        beforeCallMethods: [],
        afterCallMethods: []
      }
    return this.methodNameMapParameterTypes[methodName]
  }

  /* 合并父类的Metadata内容 */
  private _merge(parent: Metadata) {
    /* 复制父类的字段类型 */
    this._fieldTypes = deepAssign(deepAssign({}, parent._fieldTypes), this._fieldTypes)

    /* 复制父类的用户数据 */
    this._userData = deepAssign(deepAssign({}, parent._userData), this._userData)

    /* 复制父类的构造函数入参类型 */
    const parentConstructorParamTypes = parent.methodNameMapParameterTypes._constructor
    if (parentConstructorParamTypes) {
      this.copiedConstructorParams = true
      this.methodNameMapParameterTypes._constructor = {
        types: parentConstructorParamTypes.types.slice(),
        getters: deepAssign({}, parentConstructorParamTypes.getters),
        beforeCallMethods: [],
        afterCallMethods: []
      }
    }
    return this
  }
}
