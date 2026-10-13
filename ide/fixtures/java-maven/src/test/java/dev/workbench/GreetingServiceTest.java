package dev.workbench;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
public class GreetingServiceTest {
    @Test void greetsByName() { assertEquals("Hello, Workbench", new GreetingService().greet("Workbench")); }
}
