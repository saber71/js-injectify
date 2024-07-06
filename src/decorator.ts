import "reflect-metadata"
import type { Class } from "@heraclius/js-tools"
import { Metadata } from "./metadata"
import type { InjectableOptions, InjectOptions, MethodParameterOption, MethodParameterTypes } from "./types"

/**
 * 获取装饰器名称。
 *
 * 根据传入的上下文对象或字符串，返回相应的名称。
 * 如果传入的是一个字符串，则直接返回该字符串。
 * 如果传入的是一个装饰器上下文对象，则返回对象内的name属性值，如果name属性不存在，则返回空字符串。
 *
 * @param ctx 可选参数，可以是一个字符串或者一个类成员装饰器上下文对象。
 * @returns 返回一个字符串，表示装饰器的名称。
 */
export function getDecoratedName(ctx?: string | ClassMemberDecoratorContext) {
  // 如果ctx是字符串类型，则直接返回该字符串
  if (typeof ctx === "string") return ctx
  // 如果ctx是对象类型，返回其name属性值；如果不存在name属性，则返回空字符串
  return ctx?.name ?? ""
}

/**
 * 参数(parameterTypes)：包含方法或构造函数参数类型信息的对象。
 * option：可选参数，用于指定参数类型的额外选项，可以包含paramtypes（参数类型数组）和paramGetters（参数自定义getter函数对象）。
 * types：可选参数，函数类型的数组，用于指定参数的类型。
 *
 * 该函数主要根据提供的option和types来填充parameterTypes对象的types和getters属性。
 * 如果没有提供足够的信息来确定参数类型，会抛出InjectNotFoundTypeError错误。
 */
export function fillInMethodParameterTypes(
  parameterTypes: MethodParameterTypes,
  option?: MethodParameterOption,
  types?: Function[]
) {
  // 如果没有提供paramtypes、paramGetters和types，则抛出错误
  if (!option?.paramtypes && !option?.paramGetters && !types)
    throw new InjectNotFoundTypeError("无法通过元数据获取方法入参类型，必须指定类型")
  if (option) {
    // 填充paramtypes
    if (option.paramtypes) {
      for (let index in option.paramtypes) {
        const i = Number(index)
        if (parameterTypes.types[i]) continue
        parameterTypes.types[i] = option.paramtypes[index]
      }
    }
    // 填充paramGetters
    if (option.paramGetters) {
      for (let index in option.paramGetters) {
        if (parameterTypes.getters[index]) continue
        parameterTypes.getters[index] = option.paramGetters[index]
      }
    }
  }
  // 填充types
  if (types) {
    for (let i = 0; i < types.length; i++) {
      if (parameterTypes.types[i]) continue
      parameterTypes.types[i] = types[i].name
    }
  }
}

/**
 * 类装饰器。获取类的构造函数的入参类型，标记该类可以被依赖注入
 * 如果父类没有用Injectable装饰，那么子类就必须要声明构造函数，否则的话无法通过元数据得到子类正确的构造函数入参类型
 *
 * 参数(option)：可选参数，用于配置类的依赖注入选项，如moduleName，singleton等。
 *
 * 该装饰器会为类添加依赖注入相关的元数据，使其可以被依赖注入框架使用。
 */
export function Injectable(option?: InjectableOptions) {
  return (clazz: Class, ctx?: any) => {
    const metadata = Metadata.getOrCreate(clazz)
    metadata.injectable = true
    metadata.moduleName = option?.moduleName
    metadata.singleton = option?.singleton
    metadata.createImmediately = option?.createImmediately
    metadata.overrideParent = option?.overrideParent
    metadata.onCreate = option?.onCreate
    const parameterTypes = metadata.getMethodParameterTypes()
    const designParameterTypes = Reflect.getMetadata("design:paramtypes", clazz)
    const overrideConstructor = option?.overrideConstructor ?? true
    if (!overrideConstructor && metadata.copiedConstructorParams) return
    /* 如果构造函数有定义，就清空从父类处继承来的构造函数入参类型信息 */
    if (designParameterTypes && metadata.copiedConstructorParams) {
      metadata.copiedConstructorParams = false
      parameterTypes.types.length = 0
      parameterTypes.getters = {}
    }
    fillInMethodParameterTypes(parameterTypes, option, designParameterTypes ?? [])
  }
}

/**
 * 参数装饰器、属性装饰器，方法装饰器。
 * 当装饰方法时，获取方法的入参类型。当装饰属性时，获取数的入参类型。当装饰方法的入参时，用来指定该入参的类型，会覆盖方法装饰器中所指定的类型
 *
 * 参数(option)：可选参数，包含typeLabel（指定字段或入参的类型）和typeValueGetter（指定字段或入参的自定义getter）。
 * 如果仅提供一个字符串参数，该字符串将被视为typeLabel。
 *
 * 如果无法确定被装饰者的类型时，会抛出InjectNotFoundTypeError错误。
 */
export function Inject(option?: InjectOptions | string) {
  return (clazz: any, propName: ClassFieldDecoratorContext | any, index?: any) => {
    propName = getDecoratedName(propName) || "constructor"
    const typeLabel = typeof option === "string" ? option : option?.typeLabel
    if (typeof option === "string") option = {}
    const typeValueGetter = option?.typeValueGetter
    if (typeof index === "number") {
      /* 构造函数或方法的参数装饰器 */
      const metadata = Metadata.getOrCreate(clazz)
      const methodParameterTypes = metadata.getMethodParameterTypes(propName)

      /* 如果已有的构造函数入参是从父类继承的，就清空这些类型信息 */
      if (propName === "constructor" && metadata.copiedConstructorParams) {
        metadata.copiedConstructorParams = false
        methodParameterTypes.types.length = 0
        methodParameterTypes.getters = {}
      }

      if (typeLabel) methodParameterTypes.types[index] = typeLabel
      if (typeValueGetter) methodParameterTypes.getters[index] = typeValueGetter

      option?.afterExecute?.(metadata, metadata.clazz.name, propName, index)
    } else {
      /* 属性或方法装饰器 */
      const metadata = Metadata.getOrCreate(clazz)
      const types = Reflect.getMetadata("design:paramtypes", clazz, propName)
      if (types) {
        /* 方法装饰器 */
        const methodParameterTypes = metadata.getMethodParameterTypes(propName)
        fillInMethodParameterTypes(methodParameterTypes, option, types)
        if (option?.beforeCallMethod) methodParameterTypes.beforeCallMethods.push(option.beforeCallMethod)
        if (option?.afterCallMethod) methodParameterTypes.afterCallMethods.push(option.afterCallMethod)
      } else {
        /* 属性装饰器 */
        const type = typeLabel || Reflect.getMetadata("design:type", clazz, propName)?.name
        if (!type && !typeValueGetter) throw new InjectNotFoundTypeError("无法通过元数据获取字段类型，必须指定类型")
        metadata.fieldTypes[propName] = { type, getter: typeValueGetter }
      }
      option?.afterExecute?.(metadata, metadata.clazz.name, propName)
    }
  }
}

export function BeforeCallMethod(cb: InjectOptions["beforeCallMethod"]) {
  /**
   * 方法装饰器，用于在方法调用之前执行指定的回调函数。
   *
   * 参数(target): 目标对象。
   * 参数(methodName): 方法名。
   */
  return (target: any, methodName: any) => {
    methodName = getDecoratedName(methodName)
    const metadata = Metadata.getOrCreate(target)
    const methodParameterTypes = metadata.getMethodParameterTypes(methodName)
    methodParameterTypes.beforeCallMethods.push(cb)
  }
}

export function AfterCallMethod(cb: InjectOptions["afterCallMethod"]) {
  /**
   * 方法装饰器，用于在方法调用之后执行指定的回调函数。
   *
   * 参数(target): 目标对象。
   * 参数(methodName): 方法名。
   */
  return (target: any, methodName: any) => {
    methodName = getDecoratedName(methodName)
    const metadata = Metadata.getOrCreate(target)
    const methodParameterTypes = metadata.getMethodParameterTypes(methodName)
    methodParameterTypes.afterCallMethods.push(cb)
  }
}

/* 在装饰器Inject无法确定被装饰者类型时抛出 */
export class InjectNotFoundTypeError extends Error {}
