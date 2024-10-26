import 'reflect-metadata';
import { deepAssign } from '@heraclius/js-tools';
import EventEmitter from 'eventemitter3';

/* 收集类的元信息，包括字段类型、构造函数入参类型 */ class Metadata {
    clazz;
    /* 类名映射Metadata对象，如果存在子类，会用子类的Metadata对象合并父类的Metadata对象 */ static _classNameMapMetadata = new Map();
    /* 获取所有的Metadata对象 */ static getAllMetadata() {
        return this._classNameMapMetadata.values();
    }
    /**
   * 获取类对应的Metadata对象，如果对象不存在就新建一个。在新建Metadata对象的时候，子类的Metadata对象会合并父类的Metadata对象
   * @param clazzOrPrototype 可以是类或是类的原型
   */ static getOrCreate(clazzOrPrototype) {
        // 根据输入获取类的构造函数
        let clazz;
        if (typeof clazzOrPrototype === "object") clazz = clazzOrPrototype.constructor;
        else clazz = clazzOrPrototype;
        // 尝试从映射中获取Metadata对象，如果不存在则创建新对象
        let metadata = this._classNameMapMetadata.get(clazz.name);
        if (!metadata) {
            this._classNameMapMetadata.set(clazz.name, metadata = new Metadata(clazz));
            // 合并父类的Metadata
            let p = Object.getPrototypeOf(clazz);
            let merged = false;
            while(p?.name){
                metadata.parentClassNames.push(p.name);
                if (!merged) {
                    let parentMetadata = this._classNameMapMetadata.get(p.name);
                    if (parentMetadata && parentMetadata !== metadata) {
                        merged = true;
                        metadata._merge(parentMetadata);
                    }
                }
                p = Object.getPrototypeOf(p);
            }
        }
        return metadata;
    }
    static get(clazzOrPrototype) {
        // 根据输入获取类的构造函数
        let clazz;
        if (typeof clazzOrPrototype === "object") clazz = clazzOrPrototype.constructor;
        else clazz = clazzOrPrototype;
        // 获取指定类的Metadata对象
        return this._classNameMapMetadata.get(clazz.name);
    }
    constructor(clazz){
        this.clazz = clazz;
        this./* 标识类是否已被装饰器Injectable装饰 */ injectable = false;
        this./* 标记该类的构造函数入参类型是否是从父类复制的 */ copiedConstructorParams = false;
        this.methodNameMapParameterTypes = {};
        this._fieldTypes = {};
        this.parentClassNames = [];
        this._userData = {};
    }
    injectable;
    /* 类所属的模块 */ moduleName;
    /* 类是否是单例的 */ singleton;
    /* 类是否立即实例化 */ createImmediately;
    copiedConstructorParams;
    /* 当Injectable装饰的类生成实例时调用 */ onCreate;
    overrideParent;
    /* 保存方法的入参类型。key为方法名 */ methodNameMapParameterTypes;
    /* 字段名映射其类型名 */ _fieldTypes;
    get fieldTypes() {
        return this._fieldTypes;
    }
    /* 父类的名字 */ parentClassNames;
    /* 保存用户自定义数据 */ _userData;
    get userData() {
        return this._userData;
    }
    /* 根据方法名获取保存了入参类型的数据结构 */ getMethodParameterTypes(methodName = "_constructor") {
        // 默认为构造函数方法名
        if (methodName === "constructor") methodName = "_" + methodName;
        // 若方法的入参类型数据未初始化，则初始化之
        if (!this.methodNameMapParameterTypes[methodName]) this.methodNameMapParameterTypes[methodName] = {
            types: [],
            getters: {},
            beforeCallMethods: [],
            afterCallMethods: []
        };
        return this.methodNameMapParameterTypes[methodName];
    }
    /* 合并父类的Metadata内容 */ _merge(parent) {
        /* 复制父类的字段类型 */ this._fieldTypes = deepAssign(deepAssign({}, parent._fieldTypes), this._fieldTypes);
        /* 复制父类的用户数据 */ this._userData = deepAssign(deepAssign({}, parent._userData), this._userData);
        /* 复制父类的构造函数入参类型 */ const parentConstructorParamTypes = parent.methodNameMapParameterTypes._constructor;
        if (parentConstructorParamTypes) {
            this.copiedConstructorParams = true;
            this.methodNameMapParameterTypes._constructor = {
                types: parentConstructorParamTypes.types.slice(),
                getters: deepAssign({}, parentConstructorParamTypes.getters),
                beforeCallMethods: [],
                afterCallMethods: []
            };
        }
        return this;
    }
}

/**
 * 获取装饰器名称。
 *
 * 根据传入的上下文对象或字符串，返回相应的名称。
 * 如果传入的是一个字符串，则直接返回该字符串。
 * 如果传入的是一个装饰器上下文对象，则返回对象内的name属性值，如果name属性不存在，则返回空字符串。
 *
 * @param ctx 可选参数，可以是一个字符串或者一个类成员装饰器上下文对象。
 * @returns 返回一个字符串，表示装饰器的名称。
 */ function getDecoratedName(ctx) {
    // 如果ctx是字符串类型，则直接返回该字符串
    if (typeof ctx === "string") return ctx;
    // 如果ctx是对象类型，返回其name属性值；如果不存在name属性，则返回空字符串
    return ctx?.name ?? "";
}
/**
 * 参数(parameterTypes)：包含方法或构造函数参数类型信息的对象。
 * option：可选参数，用于指定参数类型的额外选项，可以包含paramtypes（参数类型数组）和paramGetters（参数自定义getter函数对象）。
 * types：可选参数，函数类型的数组，用于指定参数的类型。
 *
 * 该函数主要根据提供的option和types来填充parameterTypes对象的types和getters属性。
 * 如果没有提供足够的信息来确定参数类型，会抛出InjectNotFoundTypeError错误。
 */ function fillInMethodParameterTypes(parameterTypes, option, types) {
    // 如果没有提供paramtypes、paramGetters和types，则抛出错误
    if (!option?.paramtypes && !option?.paramGetters && !types) throw new InjectNotFoundTypeError("无法通过元数据获取方法入参类型，必须指定类型");
    if (option) {
        // 填充paramtypes
        if (option.paramtypes) {
            for(let index in option.paramtypes){
                const i = Number(index);
                if (parameterTypes.types[i]) continue;
                parameterTypes.types[i] = option.paramtypes[index];
            }
        }
        // 填充paramGetters
        if (option.paramGetters) {
            for(let index in option.paramGetters){
                if (parameterTypes.getters[index]) continue;
                parameterTypes.getters[index] = option.paramGetters[index];
            }
        }
    }
    // 填充types
    if (types) {
        for(let i = 0; i < types.length; i++){
            if (parameterTypes.types[i]) continue;
            parameterTypes.types[i] = types[i].name;
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
 */ function Injectable(option) {
    return (clazz, ctx)=>{
        const metadata = Metadata.getOrCreate(clazz);
        metadata.injectable = true;
        metadata.moduleName = option?.moduleName;
        metadata.singleton = option?.singleton;
        metadata.createImmediately = option?.createImmediately;
        metadata.overrideParent = option?.overrideParent;
        metadata.onCreate = option?.onCreate;
        const parameterTypes = metadata.getMethodParameterTypes();
        const designParameterTypes = Reflect.getMetadata("design:paramtypes", clazz);
        const overrideConstructor = option?.overrideConstructor ?? true;
        if (!overrideConstructor && metadata.copiedConstructorParams) return;
        /* 如果构造函数有定义，就清空从父类处继承来的构造函数入参类型信息 */ if (designParameterTypes && metadata.copiedConstructorParams) {
            metadata.copiedConstructorParams = false;
            parameterTypes.types.length = 0;
            parameterTypes.getters = {};
        }
        fillInMethodParameterTypes(parameterTypes, option, designParameterTypes ?? []);
    };
}
/**
 * 参数装饰器、属性装饰器，方法装饰器。
 * 当装饰方法时，获取方法的入参类型。当装饰属性时，获取数的入参类型。当装饰方法的入参时，用来指定该入参的类型，会覆盖方法装饰器中所指定的类型
 *
 * 参数(option)：可选参数，包含typeLabel（指定字段或入参的类型）和typeValueGetter（指定字段或入参的自定义getter）。
 * 如果仅提供一个字符串参数，该字符串将被视为typeLabel。
 *
 * 如果无法确定被装饰者的类型时，会抛出InjectNotFoundTypeError错误。
 */ function Inject(option) {
    return (clazz, propName, index)=>{
        propName = getDecoratedName(propName) || "constructor";
        const typeLabel = typeof option === "string" ? option : option?.typeLabel;
        if (typeof option === "string") option = {};
        const typeValueGetter = option?.typeValueGetter;
        if (typeof index === "number") {
            /* 构造函数或方法的参数装饰器 */ const metadata = Metadata.getOrCreate(clazz);
            const methodParameterTypes = metadata.getMethodParameterTypes(propName);
            /* 如果已有的构造函数入参是从父类继承的，就清空这些类型信息 */ if (propName === "constructor" && metadata.copiedConstructorParams) {
                metadata.copiedConstructorParams = false;
                methodParameterTypes.types.length = 0;
                methodParameterTypes.getters = {};
            }
            if (typeLabel) methodParameterTypes.types[index] = typeLabel;
            if (typeValueGetter) methodParameterTypes.getters[index] = typeValueGetter;
            option?.afterExecute?.(metadata, metadata.clazz.name, propName, index);
        } else {
            /* 属性或方法装饰器 */ const metadata = Metadata.getOrCreate(clazz);
            const types = Reflect.getMetadata("design:paramtypes", clazz, propName);
            if (types) {
                /* 方法装饰器 */ const methodParameterTypes = metadata.getMethodParameterTypes(propName);
                fillInMethodParameterTypes(methodParameterTypes, option, types);
                if (option?.beforeCallMethod) methodParameterTypes.beforeCallMethods.push(option.beforeCallMethod);
                if (option?.afterCallMethod) methodParameterTypes.afterCallMethods.push(option.afterCallMethod);
            } else {
                /* 属性装饰器 */ const type = typeLabel || Reflect.getMetadata("design:type", clazz, propName)?.name;
                if (!type && !typeValueGetter) throw new InjectNotFoundTypeError("无法通过元数据获取字段类型，必须指定类型");
                metadata.fieldTypes[propName] = {
                    type,
                    getter: typeValueGetter
                };
            }
            option?.afterExecute?.(metadata, metadata.clazz.name, propName);
        }
    };
}
function BeforeCallMethod(cb) {
    /**
   * 方法装饰器，用于在方法调用之前执行指定的回调函数。
   *
   * 参数(target): 目标对象。
   * 参数(methodName): 方法名。
   */ return (target, methodName)=>{
        methodName = getDecoratedName(methodName);
        const metadata = Metadata.getOrCreate(target);
        const methodParameterTypes = metadata.getMethodParameterTypes(methodName);
        methodParameterTypes.beforeCallMethods.push(cb);
    };
}
function AfterCallMethod(cb) {
    /**
   * 方法装饰器，用于在方法调用之后执行指定的回调函数。
   *
   * 参数(target): 目标对象。
   * 参数(methodName): 方法名。
   */ return (target, methodName)=>{
        methodName = getDecoratedName(methodName);
        const metadata = Metadata.getOrCreate(target);
        const methodParameterTypes = metadata.getMethodParameterTypes(methodName);
        methodParameterTypes.afterCallMethods.push(cb);
    };
}
/* 在装饰器Inject无法确定被装饰者类型时抛出 */ class InjectNotFoundTypeError extends Error {
}

const prefix = "__container-label__";
function containerLabel(label) {
    return Symbol(prefix + label);
}
function isContainerLabel(arg) {
    return typeof arg === "symbol" && new RegExp("^" + prefix).test(arg.description);
}
function getLabel(label) {
    if (isContainerLabel(label)) return label.description.replace(prefix, "");
    return label;
}
/* 用来管理需要进行依赖注入的实例的容器。这个类专门进行内容的管理 */ class Container extends EventEmitter {
    /* 缓存容器中的内容，名字映射Member对象 */ _memberMap = new Map();
    /* 父容器。在当前容器中找不到值时，会尝试在父容器中寻找 */ _extend;
    /**
   * 设置要继承的父容器。当从容器中找不到值时，会尝试在父容器中寻找
   * 会继承父容器中的可依赖注入对象，并将生成实例时的上下文环境替换成此实例
   * 在取消继承时删除之
   */ extend(parent) {
        if (this._extend === parent) return this;
        if (this._extend) {
            this._extend.off("loadClass", this._onLoadClass, this);
            Array.from(this._memberMap.values()).filter((member)=>member.isExtend).forEach((member)=>{
                if (member.isExtend) this._memberMap.delete(member.name);
            });
        }
        this._extend = parent;
        if (this._extend) {
            this._extend.on("loadClass", this._onLoadClass, this);
            Array.from(this._extend._memberMap.values()).filter((member)=>member.metadata).forEach(this._extendMember.bind(this));
        }
        return this;
    }
    /* 处理父容器触发的loadClass事件 */ _onLoadClass(clazz, member) {
        this._extendMember(member);
        this.emit("loadClass", clazz, member);
    }
    /* 继承父容器中的可依赖注入对象 */ _extendMember(member) {
        if (!this._memberMap.has(member.name)) {
            const isLoadable = this instanceof LoadableContainer;
            this._memberMap.set(member.name, {
                ...member,
                getterContext: isLoadable ? this : member.getterContext,
                factoryContext: isLoadable ? this : member.factoryContext,
                isExtend: true
            });
        }
    }
    /* 给定的类实例，以类名为标识符绑定至容器中 */ bindInstance(instance) {
        return this.bindValue(instance.constructor.name, instance);
    }
    /**
   * 给指定的标识符绑定值
   * @param label 标识符
   * @param value 指定的值
   * @throws InvalidValueError 当从容器获取值，如果值不合法时抛出
   * @throws ForbiddenOverrideInjectableError 当要覆盖可依赖注入的对象时抛出
   */ bindValue(label, value) {
        label = getLabel(label);
        if (value === undefined) throw new InvalidValueError("绑定的值不能是undefined");
        let member = this._memberMap.get(label);
        if (!member) member = this._newMember(label);
        if (member.metadata) throw new ForbiddenOverrideInjectableError("不能覆盖可依赖注入的对象" + label);
        member.value = value;
        return this;
    }
    /**
   * 给指定的标识符绑定一个工厂函数，在每次访问时生成一个新值
   * @throws ForbiddenOverrideInjectableError 当要覆盖可依赖注入的对象时抛出
   */ bindFactory(label, value, context) {
        label = getLabel(label);
        let member = this._memberMap.get(label);
        if (!member) member = this._newMember(label);
        if (member.metadata) throw new ForbiddenOverrideInjectableError("不能覆盖可依赖注入的对象" + label);
        member.factory = value;
        member.factoryContext = context;
        return this;
    }
    /**
   * 给指定的标识符绑定一个getter，只在第一次访问时执行
   * @throws ForbiddenOverrideInjectableError 当要覆盖可依赖注入的对象时抛出
   */ bindGetter(label, value, context) {
        label = getLabel(label);
        let member = this._memberMap.get(label);
        if (!member) member = this._newMember(label);
        if (member.metadata) throw new ForbiddenOverrideInjectableError("不能覆盖可依赖注入的对象" + label);
        member.getter = value;
        member.getterContext = context;
        member.getterValue = undefined;
        return this;
    }
    /* 解绑指定的标识符 */ unbind(label) {
        this._memberMap.delete(label);
        return this;
    }
    /* 解绑所有标识符 */ unbindAll() {
        this._memberMap.clear();
    }
    /* 释放资源 */ dispose() {
        this.unbindAll();
        this.extend(undefined);
    }
    hasLabel(label) {
        return this._memberMap.has(label) || !!this._extend?.hasLabel(label);
    }
    /**
   * 获取指定标识符的值
   * @param label 要获取值的标识符
   * @param args 生成值所需的参数
   * @throws InvalidValueError 当从容器获取值，如果值不合法时抛出
   * @throws NotExistLabelError 当从容器访问一个不存在的标识符时抛出
   */ getValue(label, ...args) {
        if (typeof label === "symbol" || isContainerLabel(label)) label = label.description.replace(prefix, "");
        else if (typeof label !== "string") label = label.name;
        const member = this._memberMap.get(label);
        if (!member) {
            if (this._extend) return this._extend.getValue(label, ...args);
            throw new NotExistLabelError(`容器内不存在名为${label}的标识符`);
        }
        let value = member.value;
        if (value === undefined) {
            if (member.factory) value = member.factory.call(member.factoryContext, ...args);
            else {
                value = member.getterValue;
                if (value === undefined && member.getter) {
                    value = member.getterValue = member.getter.call(member.getterContext);
                    member.getter = undefined;
                }
            }
        }
        if (value === undefined) throw new InvalidValueError("从容器获取的值不能是undefined");
        return value;
    }
    /**
   * 调用方法，其入参必须支持依赖注入
   * @throws MethodNotDecoratedInjectError 试图调用一个未装饰Inject的方法时抛出
   */ async call(instance, methodName) {
        const metadata = Metadata.getOrCreate(instance.constructor);
        if (!(methodName in metadata.methodNameMapParameterTypes)) throw new MethodNotDecoratedInjectError(methodName + "方法未装饰Inject");
        const methodParameter = metadata.methodNameMapParameterTypes[methodName];
        const args = this._getMethodParameters(methodParameter);
        for (let cb of methodParameter.beforeCallMethods){
            await cb?.(this, metadata, args);
        }
        try {
            let returnValue = await instance[methodName](...args);
            for (let cb of methodParameter.afterCallMethods){
                returnValue = await cb?.(this, metadata, returnValue, args);
            }
            return returnValue;
        } catch (e) {
            for (let cb of methodParameter.afterCallMethods){
                await cb?.(this, metadata, undefined, args, e);
            }
            throw e;
        }
    }
    /**
   * 调用方法，其入参必须支持依赖注入
   * @throws MethodNotDecoratedInjectError 试图调用一个未装饰Inject的方法时抛出
   */ callSync(instance, methodName) {
        const metadata = Metadata.getOrCreate(instance.constructor);
        if (!(methodName in metadata.methodNameMapParameterTypes)) throw new MethodNotDecoratedInjectError(methodName + "方法未装饰Inject");
        const methodParameter = metadata.methodNameMapParameterTypes[methodName];
        const args = this._getMethodParameters(methodParameter);
        for (let cb of methodParameter.beforeCallMethods){
            cb?.(this, metadata, args);
        }
        try {
            let returnValue = instance[methodName](...args);
            for (let cb of methodParameter.afterCallMethods){
                returnValue = cb?.(this, metadata, returnValue, args);
            }
            return returnValue;
        } catch (e) {
            for (let cb of methodParameter.afterCallMethods){
                cb?.(this, metadata, undefined, args, e);
            }
            throw e;
        }
    }
    /* 获取方法的入参 */ _getMethodParameters(parameters) {
        if (!parameters) return [];
        return parameters.types.map((type, index)=>parameters.getters[index]?.(this) ?? this.getValue(type));
    }
    /* 生成并缓存一个新Member对象 */ _newMember(name, metadata) {
        const member = {
            name,
            metadata
        };
        this._memberMap.set(name, member);
        return member;
    }
}
/**
 * 负责实现依赖注入的核心功能，包括得到依赖关系、生成实例、向实例注入依赖
 * @throws DependencyCycleError 当依赖循环时抛出
 */ class LoadableContainer extends Container {
    /* 标识是否调用过load方法 */ _loaded = false;
    /**
   * 加载所有已被装饰器Injectable装饰的类且所属于指定的模块
   * @throws ContainerRepeatLoadError 当重复调用Container.load方法时抛出
   */ load(option = {}) {
        if (this._loaded) throw new ContainerRepeatLoadError("LoadableContainer.load方法已被调用过，不能重复调用");
        this._loaded = true;
        const metadataArray = Array.from(Metadata.getAllMetadata());
        this.loadFromMetadata(metadataArray, option);
    }
    /* 从元数据中加载内容进容器中 */ loadFromMetadata(metadataArray, option = {}) {
        const { overrideParent = false, moduleName } = option;
        metadataArray = metadataArray.filter((metadata)=>!moduleName || !metadata.moduleName || metadata.moduleName === moduleName);
        for (let metadata of metadataArray){
            this._newMember(metadata.clazz.name, metadata);
        }
        if (overrideParent) {
            for (let item of metadataArray){
                if (item.overrideParent === false) continue;
                const member = this._memberMap.get(item.clazz.name);
                /* 如果Member已被覆盖就跳过。可能是因为metadata顺序的原因，子类顺序先于父类 */ if (member.name !== item.clazz.name) continue;
                for (let parentClassName of item.parentClassNames){
                    this._memberMap.set(parentClassName, member);
                }
            }
        }
        const createImmediately = [];
        const creating = new Set();
        for (let member of this._memberMap.values()){
            const { metadata } = member;
            if (metadata) {
                const { clazz, fieldTypes } = metadata;
                const generator = function() {
                    if (creating.has(member.name)) throw new DependencyCycleError("依赖循环：" + Array.from(creating).join("->") + member.name);
                    creating.add(member.name);
                    const instance = new clazz(...this._getMethodParameters(metadata.getMethodParameterTypes()));
                    for(let propName in fieldTypes){
                        instance[propName] = this._getFieldValue(fieldTypes[propName]);
                    }
                    creating.delete(member.name);
                    metadata.onCreate?.(instance);
                    return instance;
                };
                if (metadata.createImmediately) createImmediately.push(member);
                if (metadata.singleton) {
                    member.getter = generator;
                    member.getterContext = this;
                } else {
                    member.factory = generator;
                    member.factoryContext = this;
                }
                this.emit("loadClass", clazz, member);
            }
        }
        for (let member of createImmediately){
            this.getValue(member.name);
        }
    }
    /* 将提供的类绑定进容器内 */ loadFromClass(clazz, option = {}) {
        this.loadFromMetadata(clazz.map((c)=>Metadata.getOrCreate(c)), option);
    }
    /* 获取字段的值 */ _getFieldValue(fieldType) {
        if (!fieldType.getter && !fieldType.type) throw new Error("无法通过元数据获取字段类型，必须指定类型");
        return fieldType.getter?.(this) ?? this.getValue(fieldType.type);
    }
}
/* 当重复调用Container.load方法时抛出 */ class ContainerRepeatLoadError extends Error {
}
/* 当依赖循环时抛出 */ class DependencyCycleError extends Error {
}
/* 当从容器获取值，如果值不合法时抛出 */ class InvalidValueError extends Error {
}
/* 当从容器访问一个不存在的标识符时抛出 */ class NotExistLabelError extends Error {
}
/* 试图调用一个未装饰Inject的方法时抛出 */ class MethodNotDecoratedInjectError extends Error {
}
/* 当要覆盖可依赖注入的对象时抛出 */ class ForbiddenOverrideInjectableError extends Error {
}

export { AfterCallMethod, BeforeCallMethod, Container, ContainerRepeatLoadError, DependencyCycleError, ForbiddenOverrideInjectableError, Inject, InjectNotFoundTypeError, Injectable, InvalidValueError, LoadableContainer, Metadata, MethodNotDecoratedInjectError, NotExistLabelError, containerLabel, fillInMethodParameterTypes, getDecoratedName, isContainerLabel };
