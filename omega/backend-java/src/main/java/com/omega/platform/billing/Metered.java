package com.omega.platform.billing;

import java.lang.annotation.*;

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Metered { CreditOperation value(); }
